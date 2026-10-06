export const CURRENCIES = [
  { code: "USD", label: "US Dollar" },
  { code: "INR", label: "Indian Rupee" },
  { code: "EUR", label: "Euro" },
  { code: "GBP", label: "British Pound" },
  { code: "AED", label: "UAE Dirham" },
  { code: "AUD", label: "Australian Dollar" },
  { code: "CAD", label: "Canadian Dollar" },
  { code: "SGD", label: "Singapore Dollar" },
  { code: "CHF", label: "Swiss Franc" },
  { code: "JPY", label: "Japanese Yen" },
  { code: "CNY", label: "Chinese Yuan" },
  { code: "HKD", label: "Hong Kong Dollar" },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

export const UNITS = [
  { code: "toz", label: "Troy oz", per: "per troy ounce" },
  { code: "g", label: "Gram", per: "per gram" },
  { code: "10g", label: "10 g", per: "per 10 grams" },
] as const;

export type UnitCode = (typeof UNITS)[number]["code"];

const GRAMS_PER_TROY_OUNCE = 31.1034768;

export function isCurrency(value: string): value is CurrencyCode {
  return CURRENCIES.some((currency) => currency.code === value);
}

export function isUnit(value: string): value is UnitCode {
  return UNITS.some((unit) => unit.code === value);
}

export function convertFromTroyOunce(price: number, unit: UnitCode) {
  if (unit === "g") return price / GRAMS_PER_TROY_OUNCE;
  if (unit === "10g") return (price / GRAMS_PER_TROY_OUNCE) * 10;
  return price;
}

export function unitCaption(unit: UnitCode) {
  return UNITS.find((item) => item.code === unit)?.per ?? "per troy ounce";
}
