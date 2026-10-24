import { TradesPage } from "@/components/simple-pages";
import { configured } from "@/lib/env";
export default function Trades() {
  return <TradesPage connected={configured()} />;
}
