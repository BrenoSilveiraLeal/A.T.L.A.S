import { BuildingClient } from "@/components/building/building-client";

/** Public entry point: the building map is visible before authentication; office pages enforce AAL2. */
export default function BuildingPage() {
  return <BuildingClient />;
}
