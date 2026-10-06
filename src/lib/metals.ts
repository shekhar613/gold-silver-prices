import { isCurrency, type CurrencyCode } from "@/lib/units";
import { connection } from "next/server";

const API_BASE = "https://api.metals.dev/v1";
const CACHE_MS = 60_000;

export type HistoryPoint = {
  date: string;
  price: number;
};

export type Quote = {
  metal: "gold" | "silver";
  price: number;
  ask: number;
  bid: number;
  high: number;
  low: number;
  change: number;
  changePercent: number;
  asOf: string;
  history: HistoryPoint[];
};

export type RatesData = {
  currency: CurrencyCode;
  unit: "toz";
  fetchedAt: string;
  quotes: Quote[];
};

export type RatesResult =
  | { ok: true; data: RatesData }
  | { ok: false; error: string; missingKey: boolean };

type CacheEntry = {
  expires: number;
  data: RatesData;
};

const quoteCache = new Map<CurrencyCode, CacheEntry>();
let historyCache: { expires: number; gold: HistoryPoint[]; silver: HistoryPoint[] } | null =
  null;

class MetalsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetalsError";
  }
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function metalsGet(path: string, params: Record<string, string>) {
  const apiKey = process.env.METALS_API_KEY?.trim();
  if (!apiKey) {
    throw new MetalsError("MISSING_KEY");
  }

  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set("api_key", apiKey);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new MetalsError("Could not reach Metals.Dev. Check your connection and try again.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new MetalsError("Metals.Dev returned a response that could not be read.");
  }

  if (!body || typeof body !== "object") {
    throw new MetalsError("Metals.Dev returned an unexpected response.");
  }

  const record = body as Record<string, unknown>;
  if (!response.ok || record.status === "failure") {
    const message = readString(record.error_message) ?? "Metals.Dev rejected the request.";
    throw new MetalsError(message);
  }

  return record;
}

function parseSpot(record: Record<string, unknown>, metal: "gold" | "silver"): Quote {
  const rate = record.rate;
  if (!rate || typeof rate !== "object") {
    throw new MetalsError(`Spot prices for ${metal} were missing from the response.`);
  }

  const values = rate as Record<string, unknown>;
  const price = readNumber(values.price);
  const ask = readNumber(values.ask);
  const bid = readNumber(values.bid);
  const high = readNumber(values.high);
  const low = readNumber(values.low);
  const change = readNumber(values.change);
  const changePercent = readNumber(values.change_percent);
  const asOf = readString(record.timestamp);

  if (
    price === null ||
    ask === null ||
    bid === null ||
    high === null ||
    low === null ||
    change === null ||
    changePercent === null ||
    !asOf
  ) {
    throw new MetalsError(`Spot prices for ${metal} were incomplete.`);
  }

  return {
    metal,
    price,
    ask,
    bid,
    high,
    low,
    change,
    changePercent,
    asOf,
    history: [],
  };
}

function parseHistory(record: Record<string, unknown>, metal: "gold" | "silver") {
  const rates = record.rates;
  if (!rates || typeof rates !== "object") return [];

  const points: HistoryPoint[] = [];
  for (const [key, value] of Object.entries(rates)) {
    if (!value || typeof value !== "object") continue;
    const day = value as Record<string, unknown>;
    const metals = day.metals;
    if (!metals || typeof metals !== "object") continue;
    const price = readNumber((metals as Record<string, unknown>)[metal]);
    if (price === null) continue;
    points.push({ date: readString(day.date) ?? key, price });
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

async function loadHistory() {
  if (historyCache && historyCache.expires > Date.now()) {
    return historyCache;
  }

  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 13);

  try {
    const record = await metalsGet("/timeseries", {
      start_date: isoDate(start),
      end_date: isoDate(end),
    });
    const next = {
      expires: Date.now() + CACHE_MS,
      gold: parseHistory(record, "gold"),
      silver: parseHistory(record, "silver"),
    };
    historyCache = next;
    return next;
  } catch {
    return { expires: 0, gold: [], silver: [] };
  }
}

async function loadRates(currency: CurrencyCode): Promise<RatesData> {
  const [goldRecord, silverRecord, history] = await Promise.all([
    metalsGet("/metal/spot", { metal: "gold", currency }),
    metalsGet("/metal/spot", { metal: "silver", currency }),
    loadHistory(),
  ]);

  const gold = parseSpot(goldRecord, "gold");
  const silver = parseSpot(silverRecord, "silver");
  gold.history = history.gold;
  silver.history = history.silver;

  return {
    currency,
    unit: "toz",
    fetchedAt: new Date().toISOString(),
    quotes: [gold, silver],
  };
}

export async function getRates(
  currencyInput: string,
  options: { fresh?: boolean } = {},
): Promise<RatesResult> {
  await connection();
  const currency = currencyInput.toUpperCase();
  if (!isCurrency(currency)) {
    return { ok: false, error: "That currency is not supported.", missingKey: false };
  }

  const cached = quoteCache.get(currency);
  if (!options.fresh && cached && cached.expires > Date.now()) {
    return { ok: true, data: cached.data };
  }

  try {
    const data = await loadRates(currency);
    quoteCache.set(currency, { expires: Date.now() + CACHE_MS, data });
    return { ok: true, data };
  } catch (error) {
    if (error instanceof MetalsError && error.message === "MISSING_KEY") {
      return {
        ok: false,
        missingKey: true,
        error: "Add your Metals.Dev API key to show live rates.",
      };
    }

    const message =
      error instanceof MetalsError ? error.message : "Live rates are unavailable right now.";
    return { ok: false, error: message, missingKey: false };
  }
}
