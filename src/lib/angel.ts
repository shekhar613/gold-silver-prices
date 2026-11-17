import { createHmac } from "node:crypto";
import { connection } from "next/server";

const API_BASE = "https://apiconnect.angelone.in";
const SCRIP_MASTER_URL =
  "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json";

const REFRESH_SECONDS = 5;
const QUOTE_CACHE_MS = 2_000;
const SCRIP_CACHE_MS = 6 * 60 * 60 * 1000;
const MCX_FINENESS = 995;

const MONTHS: Record<string, number> = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

export const GOLD_CATEGORIES = [
  { karat: "24K", fineness: 999 },
  { karat: "22K", fineness: 916 },
  { karat: "18K", fineness: 750 },
  { karat: "14K", fineness: 585 },
] as const;

const CONTRACTS = [
  {
    name: "GOLD",
    title: "Gold",
    metal: "gold",
    detail: "MCX gold future · 1 kg · 995 fine",
    unitLabel: "per 10 grams",
  },
  {
    name: "GOLDM",
    title: "Gold Mini",
    metal: "gold",
    detail: "MCX gold mini · 100 g · 995 fine",
    unitLabel: "per 10 grams",
  },
  {
    name: "SILVER",
    title: "Silver",
    metal: "silver",
    detail: "MCX silver future · 30 kg",
    unitLabel: "per kg",
  },
  {
    name: "SILVERM",
    title: "Silver Mini",
    metal: "silver",
    detail: "MCX silver mini · 5 kg",
    unitLabel: "per kg",
  },
] as const;

export type LiveQuote = {
  code: string;
  name: string;
  metal: "gold" | "silver";
  symbol: string;
  expiryLabel: string;
  detail: string;
  ltp: number;
  unitLabel: string;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  close: number;
  bid: number | null;
  ask: number | null;
};

export type GoldCategory = {
  karat: string;
  fineness: number;
  pricePer10g: number;
  calculated: boolean;
};

export type RatesData = {
  source: "angelone";
  currency: "INR";
  fetchedAt: string;
  marketTime: string;
  refreshSeconds: number;
  baseLabel: string;
  quotes: LiveQuote[];
  categories: GoldCategory[];
};

export type RatesResult =
  | { ok: true; data: RatesData }
  | { ok: false; error: string; missingKey: boolean };

type Config = {
  apiKey: string;
  clientCode: string;
  pin: string;
  totpSecret: string;
};

type Session = {
  jwt: string;
  expiresAt: number;
};

type Contract = {
  name: string;
  token: string;
  symbol: string;
  expiry: string;
  expiryMs: number;
};

class AngelError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AngelError";
  }
}

const AUTH_ERRORS = new Set(["AG8001", "AG8002", "AG8003"]);

let session: Session | null = null;
let loginInflight: Promise<Session> | null = null;
let publicIp: string | null = null;
let scripCache: { expires: number; contracts: Contract[] } | null = null;
let quoteMemory: { expires: number; data: RatesData } | null = null;
let quoteInflight: Promise<RatesResult> | null = null;

function normalizeTotpSecret(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  const fromUri = /[?&]secret=([^&\s]+)/i.exec(trimmed);
  const secret = fromUri ? decodeURIComponent(fromUri[1]) : trimmed;
  return secret.replace(/\s+/g, "");
}

function readCredentials() {
  return {
    apiKey: process.env.ANGEL_API_KEY?.trim() ?? "",
    clientCode: process.env.ANGEL_CLIENT_CODE?.trim() ?? "",
    pin: process.env.ANGEL_PIN?.trim() ?? "",
    totpSecret: normalizeTotpSecret(process.env.ANGEL_TOTP_SECRET),
  };
}

function missingCredentialNames() {
  const credentials = readCredentials();
  const missing: string[] = [];
  if (!credentials.apiKey) missing.push("ANGEL_API_KEY");
  if (!credentials.clientCode) missing.push("ANGEL_CLIENT_CODE");
  if (!credentials.pin) missing.push("ANGEL_PIN");
  if (!credentials.totpSecret) missing.push("ANGEL_TOTP_SECRET");
  return missing;
}

function readConfig(): Config | null {
  const credentials = readCredentials();
  if (!credentials.apiKey || !credentials.clientCode || !credentials.pin || !credentials.totpSecret) {
    return null;
  }
  return credentials;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readToken(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return readString(value);
}

function base32Decode(input: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const char of clean) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new AngelError("ANGEL_TOTP_SECRET is not a valid authenticator key.");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret: string, time = Date.now()) {
  const counter = Math.floor(time / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

function parseExpiry(value: string) {
  const match = /^(\d{2})([A-Z]{3})(\d{4})$/.exec(value);
  if (!match) return null;
  const month = MONTHS[match[2]];
  if (month === undefined) return null;
  return Date.UTC(Number(match[3]), month, Number(match[1]));
}

function formatExpiry(value: string) {
  const match = /^(\d{2})([A-Z]{3})(\d{4})$/.exec(value);
  if (!match) return value;
  const month = match[2][0] + match[2].slice(1).toLowerCase();
  return `${Number(match[1])} ${month} ${match[3]}`;
}

function startOfTodayIst() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(read("year"), read("month") - 1, read("day"));
}

function angelTimeToIso(value: string) {
  const match = /^(\d{2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const month = MONTHS[match[2].toUpperCase()];
  if (month === undefined) return null;
  const ist = Date.UTC(
    Number(match[3]),
    month,
    Number(match[1]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  return new Date(ist - 5.5 * 60 * 60 * 1000).toISOString();
}

function bearer(token: string) {
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

async function clientPublicIp() {
  if (publicIp) return publicIp;
  try {
    const response = await fetch("https://api.ipify.org?format=json", {
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    const body = readRecord(await response.json());
    const ip = body ? readString(body.ip) : null;
    if (ip) {
      publicIp = ip;
      return ip;
    }
  } catch {
    // Market-data calls only require the header to be present.
  }
  publicIp = "127.0.0.1";
  return publicIp;
}

async function angelHeaders(config: Config, jwt?: string) {
  const ip = await clientPublicIp();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    "X-ClientLocalIP": "127.0.0.1",
    "X-ClientPublicIP": ip,
    "X-MACAddress": "02:00:00:00:00:01",
    "X-PrivateKey": config.apiKey,
  };
  if (jwt) headers.Authorization = bearer(jwt);
  return headers;
}

async function postAngel(path: string, payload: unknown, jwt?: string) {
  const config = readConfig();
  if (!config) throw new AngelError("MISSING_KEY");

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: await angelHeaders(config, jwt),
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new AngelError("Could not reach Angel One. Check your connection and try again.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AngelError("Angel One returned a response that could not be read.");
  }

  const record = readRecord(body);
  if (!record) throw new AngelError("Angel One returned an unexpected response.");

  const status = record.status;
  const failed = status === false || status === "false" || (!response.ok && status !== true);
  if (failed) {
    throw new AngelError(
      readString(record.message) ?? "Angel One rejected the request.",
      readString(record.errorcode) ?? undefined,
    );
  }

  return record;
}

async function login(): Promise<Session> {
  const config = readConfig();
  if (!config) throw new AngelError("MISSING_KEY");

  const record = await postAngel("/rest/auth/angelbroking/user/v1/loginByPassword", {
    clientcode: config.clientCode,
    password: config.pin,
    totp: totp(config.totpSecret),
  });

  const data = readRecord(record.data);
  const jwt = data ? readString(data.jwtToken) : null;
  if (!jwt) throw new AngelError("Angel One did not return a session token.");

  const next: Session = { jwt, expiresAt: Date.now() + 8 * 60 * 60 * 1000 };
  session = next;
  return next;
}

async function getSession(force = false) {
  if (!force && session && session.expiresAt > Date.now()) return session;
  if (!loginInflight) {
    loginInflight = login().finally(() => {
      loginInflight = null;
    });
  }
  return loginInflight;
}

async function loadContracts() {
  if (scripCache && scripCache.expires > Date.now()) return scripCache.contracts;

  let response: Response;
  try {
    response = await fetch(SCRIP_MASTER_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
      headers: { Accept: "application/json" },
    });
  } catch {
    if (scripCache) return scripCache.contracts;
    throw new AngelError("Could not download the MCX contract list from Angel One.");
  }

  if (!response.ok) {
    if (scripCache) return scripCache.contracts;
    throw new AngelError("Angel One contract list is unavailable right now.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    if (scripCache) return scripCache.contracts;
    throw new AngelError("Angel One contract list could not be read.");
  }

  if (!Array.isArray(body)) throw new AngelError("Angel One contract list had an unexpected shape.");

  const wanted = new Set<string>(CONTRACTS.map((item) => item.name));
  const contracts: Contract[] = [];
  for (const item of body) {
    const record = readRecord(item);
    if (!record) continue;
    if (readString(record.exch_seg) !== "MCX") continue;
    if (readString(record.instrumenttype) !== "FUTCOM") continue;
    const name = readString(record.name);
    const token = readToken(record.token);
    const symbol = readString(record.symbol);
    const expiry = readString(record.expiry);
    if (!name || !token || !symbol || !expiry || !wanted.has(name)) continue;
    const expiryMs = parseExpiry(expiry);
    if (expiryMs === null) continue;
    contracts.push({ name, token, symbol, expiry, expiryMs });
  }

  if (contracts.length === 0) {
    throw new AngelError("No MCX gold or silver futures were found in the contract list.");
  }

  scripCache = { expires: Date.now() + SCRIP_CACHE_MS, contracts };
  return contracts;
}

function frontMonth(contracts: Contract[], name: string) {
  const today = startOfTodayIst();
  return (
    contracts
      .filter((contract) => contract.name === name && contract.expiryMs >= today)
      .sort((left, right) => left.expiryMs - right.expiryMs)[0] ?? null
  );
}

function depthPrice(value: unknown) {
  const record = readRecord(value);
  const book = record ? record.buy ?? record.sell : null;
  if (!Array.isArray(book) || book.length === 0) return null;
  return readNumber(readRecord(book[0])?.price);
}

function quoteFromFetched(spec: (typeof CONTRACTS)[number], contract: Contract, row: Record<string, unknown>): LiveQuote | null {
  const ltp = readNumber(row.ltp);
  if (ltp === null) return null;
  const depth = readRecord(row.depth);
  return {
    code: spec.name,
    name: spec.title,
    metal: spec.metal,
    symbol: readString(row.tradingSymbol) ?? contract.symbol,
    expiryLabel: formatExpiry(contract.expiry),
    detail: spec.detail,
    ltp,
    unitLabel: spec.unitLabel,
    change: readNumber(row.netChange) ?? 0,
    changePercent: readNumber(row.percentChange) ?? 0,
    open: readNumber(row.open) ?? ltp,
    high: readNumber(row.high) ?? ltp,
    low: readNumber(row.low) ?? ltp,
    close: readNumber(row.close) ?? ltp,
    bid: depth ? depthPrice({ buy: depth.buy }) : null,
    ask: depth ? depthPrice({ sell: depth.sell }) : null,
  };
}

function categoriesFromGold(pricePer10g: number): GoldCategory[] {
  const perGram = pricePer10g / 10;
  return GOLD_CATEGORIES.map((item) => ({
    karat: item.karat,
    fineness: item.fineness,
    pricePer10g: perGram * (item.fineness / MCX_FINENESS) * 10,
    calculated: true,
  }));
}

async function fetchMarket(tokens: string[], attempt = 0) {
  const current = await getSession(attempt > 0);
  try {
    return await postAngel(
      "/rest/secure/angelbroking/market/v1/quote/",
      { mode: "FULL", exchangeTokens: { MCX: tokens } },
      current.jwt,
    );
  } catch (error) {
    if (attempt < 1 && error instanceof AngelError && error.code && AUTH_ERRORS.has(error.code)) {
      session = null;
      return fetchMarket(tokens, attempt + 1);
    }
    throw error;
  }
}

async function loadRates(): Promise<RatesData> {
  const contracts = await loadContracts();
  const selected = CONTRACTS.flatMap((spec) => {
    const contract = frontMonth(contracts, spec.name);
    return contract ? [{ spec, contract }] : [];
  });

  if (selected.length === 0) {
    throw new AngelError("No active MCX gold or silver contract is available.");
  }

  const record = await fetchMarket(selected.map((item) => item.contract.token));
  const data = readRecord(record.data);
  const fetched = data && Array.isArray(data.fetched) ? data.fetched : [];
  const byToken = new Map<string, Record<string, unknown>>();
  let marketTime = new Date().toISOString();

  for (const item of fetched) {
    const row = readRecord(item);
    const token = row ? readToken(row.symbolToken) : null;
    if (!row || !token) continue;
    byToken.set(token, row);
    const stamp = readString(row.exchFeedTime);
    const iso = stamp ? angelTimeToIso(stamp) : null;
    if (iso) marketTime = iso;
  }

  const quotes = selected.flatMap(({ spec, contract }) => {
    const row = byToken.get(contract.token);
    if (!row) return [];
    const quote = quoteFromFetched(spec, contract, row);
    return quote ? [quote] : [];
  });

  if (quotes.length === 0) {
    const unfetched = data && Array.isArray(data.unfetched) ? data.unfetched : [];
    const first = readRecord(unfetched[0]);
    throw new AngelError(first ? (readString(first.message) ?? "Live MCX prices were missing.") : "Live MCX prices were missing.");
  }

  const gold = quotes.find((quote) => quote.code === "GOLD") ?? quotes.find((quote) => quote.metal === "gold");

  return {
    source: "angelone",
    currency: "INR",
    fetchedAt: new Date().toISOString(),
    marketTime,
    refreshSeconds: REFRESH_SECONDS,
    baseLabel: gold ? `${gold.symbol} (${gold.expiryLabel})` : "MCX gold",
    quotes,
    categories: gold ? categoriesFromGold(gold.ltp) : [],
  };
}

async function resolveRates(): Promise<RatesResult> {
  const missing = missingCredentialNames();
  if (missing.length > 0) {
    return {
      ok: false,
      missingKey: true,
      error: `Add ${missing.join(", ")} to .env.local to show live MCX rates.`,
    };
  }

  if (quoteMemory && quoteMemory.expires > Date.now()) {
    return { ok: true, data: quoteMemory.data };
  }

  try {
    const data = await loadRates();
    quoteMemory = { expires: Date.now() + QUOTE_CACHE_MS, data };
    return { ok: true, data };
  } catch (error) {
    if (quoteMemory) return { ok: true, data: quoteMemory.data };
    if (error instanceof AngelError && error.message === "MISSING_KEY") {
      const names = missingCredentialNames();
      return {
        ok: false,
        missingKey: true,
        error:
          names.length > 0
            ? `Add ${names.join(", ")} to .env.local to show live MCX rates.`
            : "Add your Angel One SmartAPI credentials to show live MCX rates.",
      };
    }
    const message = error instanceof AngelError ? error.message : "Live rates are unavailable right now.";
    return { ok: false, error: message, missingKey: false };
  }
}

export async function getRates(): Promise<RatesResult> {
  await connection();
  if (!quoteInflight) {
    quoteInflight = resolveRates().finally(() => {
      quoteInflight = null;
    });
  }
  return quoteInflight;
}
