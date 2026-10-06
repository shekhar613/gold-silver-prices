import type { HistoryPoint } from "@/lib/metals";

export function Sparkline({
  points,
  tone,
}: {
  points: HistoryPoint[];
  tone: "gold" | "silver";
}) {
  if (points.length < 2) return null;

  const width = 320;
  const height = 78;
  const prices = points.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const coordinates = prices.map((price, index) => {
    const x = (index / (prices.length - 1)) * width;
    const y = height - ((price - min) / span) * (height - 10) - 5;
    return [x, y] as const;
  });

  const line = coordinates
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const stroke = tone === "gold" ? "#e7c27a" : "#d7dbe3";
  const gradientId = `spark-${tone}`;
  const rising = prices[prices.length - 1] >= prices[0];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-20 w-full"
      role="img"
      aria-label={`${points.length}-day ${tone} trend, ${rising ? "higher" : "lower"} than the start`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
