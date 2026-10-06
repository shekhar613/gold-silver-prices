import { RatesBoard } from "@/components/rates-board";
import { getRates } from "@/lib/metals";

export default async function Home() {
  const initial = await getRates();
  return <RatesBoard initial={initial} />;
}
