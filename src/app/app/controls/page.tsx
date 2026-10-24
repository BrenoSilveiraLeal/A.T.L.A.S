import { ControlsPage } from "@/components/simple-pages";
import { configured } from "@/lib/env";
export default function Controls() {
  return <ControlsPage connected={configured()} />;
}
