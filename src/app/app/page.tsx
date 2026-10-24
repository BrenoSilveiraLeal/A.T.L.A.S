import { OfficePage } from "@/components/simple-pages";
import { configured } from "@/lib/env";
export default function Office() {
  return <OfficePage connected={configured()} />;
}
