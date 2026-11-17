import { RatesBoard } from "@/components/rates-board";
import { getRates } from "@/lib/angel";

export default async function Home() {
  const initial = await getRates();
  return <RatesBoard initial={initial} />;
}
