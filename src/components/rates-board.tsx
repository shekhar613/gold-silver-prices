"use client";

import { Sparkline } from "@/components/sparkline";
import type { Quote, RatesData, RatesResult } from "@/lib/metals";
import {
  CURRENCIES,
  UNITS,
  convertFromTroyOunce,
  isCurrency,
  unitCaption,
  type CurrencyCode,
  type UnitCode,
} from "@/lib/units";
import { useCallback, useEffect, useRef, useState } from "react";

const REFRESH_MS = 60_000;

const METALS = {
  gold: { name: "Gold", mark: "Au" },
  silver: { name: "Silver", mark: "Ag" },
} as const;

const LOCALE = "en-IN";

function formatMoney(value: number, currency: string) {
  const digits = Math.abs(value) >= 1 ? 2 : 3;
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatSigned(value: number, currency: string) {
  const amount = formatMoney(Math.abs(value), currency);
  if (value > 0) return `+${amount}`;
  if (value < 0) return `−${amount}`;
  return amount;
}

function formatPercent(value: number) {
  const amount = `${Math.abs(value).toFixed(2)}%`;
  if (value > 0) return `+${amount}`;
  if (value < 0) return `−${amount}`;
  return amount;
}

function formatClock(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function formatDay(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

function relativeSeconds(iso: string, now: number) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "just now";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return minutes === 1 ? "1 min ago" : `${minutes} min ago`;
}

function quoteByMetal(quotes: Quote[], metal: "gold" | "silver") {
  return quotes.find((quote) => quote.metal === metal) ?? null;
}

function isRatesData(value: unknown): value is RatesData {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    isCurrency(typeof record.currency === "string" ? record.currency : "") &&
    record.unit === "toz" &&
    typeof record.fetchedAt === "string" &&
    Array.isArray(record.quotes)
  );
}

export function RatesBoard({ initial }: { initial: RatesResult }) {
  const [currency, setCurrency] = useState<CurrencyCode>(
    initial.ok ? initial.data.currency : "USD",
  );
  const [unit, setUnit] = useState<UnitCode>("toz");
  const [result, setResult] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const hasRates = useRef(initial.ok);

  const load = useCallback(async (nextCurrency: CurrencyCode, fresh = false) => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/rates?currency=${nextCurrency}${fresh ? "&fresh=1" : ""}`,
      );
      const body: unknown = await response.json();
      if (!response.ok || !isRatesData(body)) {
        const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
        const message =
          typeof record.error === "string" ? record.error : "Live rates are unavailable right now.";
        const missingKey = record.missingKey === true;
        if (hasRates.current && !missingKey) {
          setNotice(message);
          return;
        }
        hasRates.current = false;
        setNotice(null);
        setResult({ ok: false, error: message, missingKey });
        return;
      }
      hasRates.current = true;
      setNotice(null);
      setResult({ ok: true, data: body });
    } catch {
      if (hasRates.current) {
        setNotice("Could not reach the rates service. Showing the last prices.");
        return;
      }
      setResult({ ok: false, error: "Could not reach the rates service.", missingKey: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    if (!result.ok && result.missingKey) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void load(currency);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [currency, load, result]);

  function chooseCurrency(next: CurrencyCode) {
    setCurrency(next);
    void load(next);
  }

  function chooseUnit(next: UnitCode) {
    setUnit(next);
  }

  const today = new Intl.DateTimeFormat(LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 py-8 sm:px-8 sm:py-12">
      <header className="flex flex-col gap-6 border-b border-line pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-medium tracking-[0.22em] text-gold uppercase">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-gold" />
            </span>
            Live spot
          </p>
          <h1 className="mt-3 font-serif text-5xl tracking-tight text-paper sm:text-6xl">
            Gold & Silver
          </h1>
          <p className="mt-2 text-sm text-paper/60">{today}</p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <label className="flex items-center gap-3 text-sm text-paper/70">
            <span className="sr-only">Currency</span>
            <select
              value={currency}
              onChange={(event) => {
                const next = event.target.value;
                if (isCurrency(next)) chooseCurrency(next);
              }}
              className="rounded-full border border-line bg-panel px-4 py-2 text-paper outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              {CURRENCIES.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.code} · {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex rounded-full border border-line bg-panel p-1" role="group" aria-label="Price unit">
            {UNITS.map((item) => {
              const selected = unit === item.code;
              return (
                <button
                  key={item.code}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => chooseUnit(item.code)}
                  className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                    selected ? "bg-paper text-ink" : "text-paper/70 hover:text-paper"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {notice ? (
        <p className="mt-6 rounded-2xl border border-down/40 bg-panel px-4 py-3 text-sm text-down">
          {notice}
        </p>
      ) : null}

      {result.ok ? (
        <Board
          data={result.data}
          unit={unit}
          loading={loading}
          now={now}
          onRefresh={() => void load(currency, true)}
        />
      ) : (
        <SetupPanel message={result.error} missingKey={result.missingKey} />
      )}
    </div>
  );
}

function Board({
  data,
  unit,
  loading,
  now,
  onRefresh,
}: {
  data: RatesData;
  unit: UnitCode;
  loading: boolean;
  now: number;
  onRefresh: () => void;
}) {
  const gold = quoteByMetal(data.quotes, "gold");
  const silver = quoteByMetal(data.quotes, "silver");
  const ratio = gold && silver && silver.price !== 0 ? gold.price / silver.price : null;
  const marketTime = data.quotes.map((quote) => quote.asOf).sort().at(-1);

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-paper/60">
        <p aria-live="polite">
          {loading ? "Updating prices…" : `Refreshed ${relativeSeconds(data.fetchedAt, now)}`}
          {marketTime ? ` · Market ${formatClock(marketTime)}` : ""}
        </p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded-full border border-line px-4 py-1.5 text-paper transition-colors hover:border-gold hover:text-gold disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {gold ? <MetalCard quote={gold} currency={data.currency} unit={unit} /> : null}
        {silver ? <MetalCard quote={silver} currency={data.currency} unit={unit} /> : null}
      </div>

      {ratio !== null ? (
        <p className="mt-5 rounded-2xl border border-line bg-panel px-5 py-4 text-sm text-paper/75">
          One troy ounce of gold buys{" "}
          <span className="font-serif text-xl text-paper">{ratio.toFixed(2)}</span> troy ounces of
          silver.
        </p>
      ) : null}

      <p className="mt-8 text-xs leading-5 text-paper/40">
        Spot prices from Metals.Dev, quoted per troy ounce and converted locally for gram and 10
        gram views. The feed can trail the market by up to a minute, and this page refreshes every
        60 seconds.
      </p>
    </>
  );
}

function MetalCard({
  quote,
  currency,
  unit,
}: {
  quote: Quote;
  currency: string;
  unit: UnitCode;
}) {
  const metal = METALS[quote.metal];
  const price = convertFromTroyOunce(quote.price, unit);
  const change = convertFromTroyOunce(quote.change, unit);
  const up = quote.change > 0;
  const down = quote.change < 0;
  const tone = up ? "text-up" : down ? "text-down" : "text-paper/70";
  const range = quote.high - quote.low;
  const marker = range === 0 ? 50 : Math.min(100, Math.max(0, ((quote.price - quote.low) / range) * 100));
  const history = quote.history;
  const firstDay = history[0]?.date;
  const lastDay = history[history.length - 1]?.date;

  return (
    <article
      className={`rounded-3xl border bg-panel p-6 sm:p-7 ${
        quote.metal === "gold" ? "border-gold/30" : "border-silver/25"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-3xl text-paper">{metal.name}</h2>
          <p className="mt-1 text-sm text-paper/50">{unitCaption(unit)}</p>
        </div>
        <span
          className={`grid h-12 w-12 place-items-center rounded-full border font-serif text-lg ${
            quote.metal === "gold"
              ? "border-gold/40 text-gold"
              : "border-silver/40 text-silver"
          }`}
          aria-hidden="true"
        >
          {metal.mark}
        </span>
      </div>

      <p className="mt-8 font-serif text-5xl tracking-tight text-paper tabular-nums sm:text-6xl">
        {formatMoney(price, currency)}
      </p>
      <p className={`mt-3 text-sm font-medium tabular-nums ${tone}`}>
        {formatSigned(change, currency)} · {formatPercent(quote.changePercent)} vs previous close
      </p>

      <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Bid" value={formatMoney(convertFromTroyOunce(quote.bid, unit), currency)} />
        <Stat label="Ask" value={formatMoney(convertFromTroyOunce(quote.ask, unit), currency)} />
        <Stat label="Low" value={formatMoney(convertFromTroyOunce(quote.low, unit), currency)} />
        <Stat label="High" value={formatMoney(convertFromTroyOunce(quote.high, unit), currency)} />
      </dl>

      <div className="mt-6">
        <div className="mb-2 flex justify-between text-xs tracking-wide text-paper/45 uppercase">
          <span>Day range</span>
          <span>Spot</span>
        </div>
        <div className="relative h-1.5 rounded-full bg-paper/10">
          <span
            className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full ${
              quote.metal === "gold" ? "bg-gold" : "bg-silver"
            }`}
            style={{ left: `calc(${marker}% - 7px)` }}
          />
        </div>
      </div>

      {history.length > 1 ? (
        <div className="mt-6">
          <div className="mb-1 flex justify-between text-xs text-paper/45">
            <span>14-day trend</span>
            <span>
              {firstDay ? formatDay(firstDay) : ""}
              {lastDay ? ` – ${formatDay(lastDay)}` : ""}
            </span>
          </div>
          <Sparkline points={history} tone={quote.metal} />
        </div>
      ) : null}
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-paper/45 uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-paper tabular-nums">{value}</dd>
    </div>
  );
}

function SetupPanel({ message, missingKey }: { message: string; missingKey: boolean }) {
  return (
    <section className="mt-8 max-w-xl rounded-3xl border border-gold/30 bg-panel p-6 sm:p-8">
      <h2 className="font-serif text-3xl text-paper">
        {missingKey ? "Connect Metals.Dev" : "Rates unavailable"}
      </h2>
      <p className="mt-3 text-sm leading-6 text-paper/70">{message}</p>
      {missingKey ? (
        <ol className="mt-6 space-y-3 text-sm leading-6 text-paper/80">
          <li>Create a key on the Metals.Dev dashboard.</li>
          <li>
            Add it to <code className="text-gold">web/.env.local</code>:
            <pre className="mt-2 overflow-x-auto rounded-xl bg-ink px-4 py-3 text-paper">
              METALS_API_KEY=your_key_here
            </pre>
          </li>
          <li>Restart the dev server, then refresh this page.</li>
        </ol>
      ) : null}
      <a
        href="https://metals.dev"
        className="mt-6 inline-flex rounded-full bg-gold px-4 py-2 text-sm font-medium text-ink"
      >
        Open Metals.Dev
      </a>
    </section>
  );
}
