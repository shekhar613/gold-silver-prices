"use client";

import type { GoldCategory, LiveQuote, RatesData, RatesResult } from "@/lib/angel";
import { useCallback, useEffect, useRef, useState } from "react";

const LOCALE = "en-IN";

function formatInr(value: number) {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatClock(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Kolkata",
    timeZoneName: "short",
  }).format(date);
}

function formatSigned(value: number, digits = 2) {
  const formatted = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

function isRatesData(value: unknown): value is RatesData {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.source === "angelone" && Array.isArray(record.quotes) && Array.isArray(record.categories);
}

export function RatesBoard({ initial }: { initial: RatesResult }) {
  const [result, setResult] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const hasRates = useRef(initial.ok);
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const response = await fetch("/api/rates", { cache: "no-store" });
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
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!result.ok && result.missingKey) return;
    const wait = result.ok ? result.data.refreshSeconds * 1000 : 15_000;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void load();
    }, wait);
    return () => window.clearInterval(timer);
  }, [load, result]);

  const today = result.ok
    ? new Intl.DateTimeFormat(LOCALE, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      }).format(new Date(result.data.marketTime))
    : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 py-8 sm:px-8 sm:py-12">
      <header className="border-b border-line pb-8">
        <p className="flex items-center gap-2 text-xs font-medium tracking-[0.22em] text-gold uppercase">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-gold" />
          </span>
          Live MCX via Angel One
        </p>
        <h1 className="mt-3 font-serif text-5xl tracking-tight text-paper sm:text-6xl">Gold & Silver</h1>
        {today ? <p className="mt-2 text-sm text-paper/60">{today}</p> : null}
      </header>

      {notice ? (
        <p className="mt-6 rounded-2xl border border-down/40 bg-panel px-4 py-3 text-sm text-down">{notice}</p>
      ) : null}

      {result.ok ? (
        <Board data={result.data} loading={loading} onRefresh={() => void load()} />
      ) : (
        <SetupPanel message={result.error} missingKey={result.missingKey} />
      )}
    </div>
  );
}

function Board({
  data,
  loading,
  onRefresh,
}: {
  data: RatesData;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-paper/60">
        <p aria-live="polite">
          {loading
            ? "Checking Angel One…"
            : `Angel One SmartAPI · refreshes every ${data.refreshSeconds} seconds`}
          {` · Feed ${formatClock(data.marketTime)}`}
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

      <section className="mt-8">
        <h2 className="font-serif text-3xl text-paper">MCX futures</h2>
        <p className="mt-1 text-sm text-paper/50">Front-month contracts. Gold is quoted per 10 grams, silver per kg.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {data.quotes.map((quote) => (
            <QuoteCard key={quote.code} quote={quote} />
          ))}
        </div>
      </section>

      {data.categories.length > 0 ? (
        <section className="mt-10">
          <h2 className="font-serif text-3xl text-paper">Gold categories</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-paper/50">
            Metal value scaled from {data.baseLabel}, which is 995 fine. 24K is 999, 22K is 916, 18K is 750,
            and 14K is 585. This is the gold value only, before making charges.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {data.categories.map((category) => (
              <CategoryCard key={category.karat} category={category} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function QuoteCard({ quote }: { quote: LiveQuote }) {
  const rising = quote.change > 0;
  const falling = quote.change < 0;
  const tone = rising ? "text-up" : falling ? "text-down" : "text-paper/60";
  const accent = quote.metal === "gold" ? "border-gold/30" : "border-silver/30";

  return (
    <article className={`rounded-3xl border bg-panel p-6 ${accent}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className={`font-serif text-2xl ${quote.metal === "gold" ? "text-gold" : "text-silver"}`}>
            {quote.name}
          </h3>
          <p className="mt-1 text-sm text-paper/50">{quote.detail}</p>
        </div>
        <p className={`text-right text-sm font-medium tabular-nums ${tone}`}>
          {formatSigned(quote.change)}
          <span className="mt-0.5 block">{formatSigned(quote.changePercent)}%</span>
        </p>
      </div>
      <p className="mt-6 font-serif text-4xl tracking-tight text-paper tabular-nums sm:text-5xl">
        {formatInr(quote.ltp)}
      </p>
      <p className="mt-2 text-sm text-paper/50">
        {quote.unitLabel}
        {quote.metal === "gold" ? ` · ${formatInr(quote.ltp / 10)} per gram` : null}
      </p>
      <p className="mt-1 text-xs tracking-wide text-paper/40 uppercase">
        {quote.symbol} · expires {quote.expiryLabel}
      </p>
      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Stat label="Open" value={quote.open} />
        <Stat label="High" value={quote.high} />
        <Stat label="Low" value={quote.low} />
        <Stat label="Prev" value={quote.close} />
        {quote.bid !== null ? <Stat label="Bid" value={quote.bid} /> : null}
        {quote.ask !== null ? <Stat label="Ask" value={quote.ask} /> : null}
      </dl>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-paper/40 uppercase">{label}</dt>
      <dd className="mt-1 text-paper tabular-nums">{formatInr(value)}</dd>
    </div>
  );
}

function CategoryCard({ category }: { category: GoldCategory }) {
  return (
    <article className="rounded-3xl border border-gold/30 bg-panel p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-3xl text-gold">{category.karat}</h3>
        <p className="text-sm text-paper/50">{category.fineness} fine</p>
      </div>
      <p className="mt-6 font-serif text-4xl tracking-tight text-paper tabular-nums sm:text-5xl">
        {formatInr(category.pricePer10g)}
      </p>
      <p className="mt-2 text-sm text-paper/50">
        per 10 grams · {formatInr(category.pricePer10g / 10)} per gram
      </p>
    </article>
  );
}

function SetupPanel({ message, missingKey }: { message: string; missingKey: boolean }) {
  return (
    <section className="mt-8 max-w-xl rounded-3xl border border-gold/30 bg-panel p-6 sm:p-8">
      <h2 className="font-serif text-3xl text-paper">{missingKey ? "Connect Angel One" : "Rates unavailable"}</h2>
      <p className="mt-3 text-sm leading-6 text-paper/70">{message}</p>
      {missingKey ? (
        <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm leading-6 text-paper/70">
          <li>Create an app at smartapi.angelone.in and copy its API key.</li>
          <li>Use your Angel One client code and trading PIN.</li>
          <li>Put the authenticator setup key in ANGEL_TOTP_SECRET, not the 6-digit code.</li>
        </ol>
      ) : null}
    </section>
  );
}
