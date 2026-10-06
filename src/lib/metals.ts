import { unstable_cache } from "next/cache";
import { connection } from "next/server";

const API_BASE = "https://api.metals.dev/v1";
const CACHE_SECONDS = 600;
const MCX_FINENESS = 995;
const FINE_GOLD = 999;

export const GOLD_CATEGORIES = [
  { karat: "24K", fineness: 999 },
  { karat: "22K", fineness: 916 },
  { karat: "18K", fineness: 750 },
  { karat: "14K", fineness: 585 },
] as const;

export type RealRate = {
  code: string;
  name: string;
  pricePerGram: number;
  detail: string;
};

export type GoldCategory = {
  karat: string;
  fineness: number;
  pricePer10g: number;
  calculated: boolean;
};

export type RatesData = {
  currency: "INR";
  unit: "g";
  fetchedAt: string;
  marketTime: string;
  cacheSeconds: number;
  base: "mcx" | "spot";
  baseLabel: string;
  realGold: RealRate[];
  realSilver: RealRate[];
  categories: GoldCategory[];
};

export type RatesResult =
  | { ok: true; data: RatesData }
  | { ok: false; error: string; missingKey: boolean };

class MetalsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetalsError";
  }
}

let memory: { expires: number; data: RatesData } | null = null;

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function per10g(pricePerGram: number) {
  return pricePerGram * 10;
}

function categoriesFrom(pricePerGram: number, sourceFineness: number): GoldCategory[] {
  return GOLD_CATEGORIES.map((item) => ({
    karat: item.karat,
    fineness: item.fineness,
    pricePer10g: per10g(pricePerGram * (item.fineness / sourceFineness)),
    calculated: true,
  }));
}

async function fetchLatest(): Promise<RatesData> {
  const apiKey = process.env.METALS_API_KEY?.trim();
  if (!apiKey) throw new MetalsError("MISSING_KEY");

  const url = new URL(`${API_BASE}/latest`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("currency", "INR");
  url.searchParams.set("unit", "g");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: CACHE_SECONDS },
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
    throw new MetalsError(readString(record.error_message) ?? "Metals.Dev rejected the request.");
  }

  const metals = record.metals;
  if (!metals || typeof metals !== "object") {
    throw new MetalsError("Metal prices were missing from the response.");
  }

  const prices = metals as Record<string, unknown>;
  const spotGold = readNumber(prices.gold);
  const spotSilver = readNumber(prices.silver);
  const mcxGold = readNumber(prices.mcx_gold);
  const mcxSilver = readNumber(prices.mcx_silver);
  const ibjaGold = readNumber(prices.ibja_gold);

  if (spotGold === null && mcxGold === null) {
    throw new MetalsError("Gold prices were missing from the response.");
  }

  const timestamps = record.timestamps;
  const marketTime =
    (timestamps && typeof timestamps === "object"
      ? readString((timestamps as Record<string, unknown>).metal)
      : null) ?? new Date().toISOString();

  const realGold: RealRate[] = [];
  if (spotGold !== null) {
    realGold.push({
      code: "gold",
      name: "Spot gold",
      pricePerGram: spotGold,
      detail: "International fine gold",
    });
  }
  if (mcxGold !== null) {
    realGold.push({
      code: "mcx_gold",
      name: "MCX gold",
      pricePerGram: mcxGold,
      detail: "Indian exchange, 995 fine",
    });
  }
  if (ibjaGold !== null) {
    realGold.push({
      code: "ibja_gold",
      name: "IBJA gold",
      pricePerGram: ibjaGold,
      detail: "Published association rate",
    });
  }

  const realSilver: RealRate[] = [];
  if (spotSilver !== null) {
    realSilver.push({
      code: "silver",
      name: "Spot silver",
      pricePerGram: spotSilver,
      detail: "International spot",
    });
  }
  if (mcxSilver !== null) {
    realSilver.push({
      code: "mcx_silver",
      name: "MCX silver",
      pricePerGram: mcxSilver,
      detail: "Indian exchange, 999 fine",
    });
  }

  const base = mcxGold !== null ? "mcx" : "spot";
  const basePrice = mcxGold ?? spotGold;
  if (basePrice === null) {
    throw new MetalsError("Gold prices were missing from the response.");
  }

  return {
    currency: "INR",
    unit: "g",
    fetchedAt: new Date().toISOString(),
    marketTime,
    cacheSeconds: CACHE_SECONDS,
    base,
    baseLabel: base === "mcx" ? "MCX gold (995 fine)" : "Spot gold (999 fine)",
    realGold,
    realSilver,
    categories: categoriesFrom(basePrice, base === "mcx" ? MCX_FINENESS : FINE_GOLD),
  };
}

const loadCachedLatest = unstable_cache(fetchLatest, ["metals-latest-inr-gram"], {
  revalidate: CACHE_SECONDS,
});

export async function getRates(): Promise<RatesResult> {
  await connection();

  if (memory && memory.expires > Date.now()) {
    return { ok: true, data: memory.data };
  }

  try {
    const data = await loadCachedLatest();
    memory = { expires: Date.now() + CACHE_SECONDS * 1000, data };
    return { ok: true, data };
  } catch (error) {
    if (memory) return { ok: true, data: memory.data };

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
