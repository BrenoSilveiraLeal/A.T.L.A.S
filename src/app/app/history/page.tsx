import { HistoryPage } from "@/components/simple-pages";
import { configured } from "@/lib/env";
export default function History() {
  return <HistoryPage connected={configured()} />;
}
