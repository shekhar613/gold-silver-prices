import { getRates } from "@/lib/metals";
import { isCurrency } from "@/lib/units";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const currency = (request.nextUrl.searchParams.get("currency") ?? "USD").toUpperCase();
  if (!isCurrency(currency)) {
    return Response.json({ error: "That currency is not supported." }, { status: 400 });
  }

  const fresh = request.nextUrl.searchParams.get("fresh") === "1";
  const result = await getRates(currency, { fresh });

  if (!result.ok) {
    return Response.json(
      { error: result.error, missingKey: result.missingKey },
      { status: result.missingKey ? 503 : 502 },
    );
  }

  return Response.json(result.data, {
    headers: { "Cache-Control": "private, max-age=30" },
  });
}
