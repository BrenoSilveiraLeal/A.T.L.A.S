import { redirect } from "next/navigation";
import { configured } from "@/lib/env";
import { requireOwner, ApiError } from "@/lib/auth";
import { BuildingClient } from "@/components/building/building-client";

/** The ATLAS building: the first screen, where the owner picks an office floor. Same owner check as /app. */
export default async function BuildingPage() {
  if (configured()) {
    try {
      await requireOwner();
    } catch (error) {
      if (error instanceof ApiError && [401, 403].includes(error.status)) redirect("/login");
      throw error;
    }
  }
  return <BuildingClient />;
}
