import { DividendsPage } from "@/components/simple-pages";
import { configured } from "@/lib/env";

export default function Page() {
  return <DividendsPage connected={configured()} />;
}
