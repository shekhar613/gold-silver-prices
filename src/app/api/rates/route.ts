import { getRates } from "@/lib/metals";

export async function GET() {
  const result = await getRates();

  if (!result.ok) {
    return Response.json(
      { error: result.error, missingKey: result.missingKey },
      { status: result.missingKey ? 503 : 502 },
    );
  }

  return Response.json(result.data, {
    headers: {
      "Cache-Control": `private, max-age=${result.data.cacheSeconds}`,
    },
  });
}
