import { redirect } from "next/navigation";
import { configured } from "@/lib/env";
import { requireOwner, ApiError } from "@/lib/auth";
import { DashClient } from "@/components/daytrade/dash-client";

/** The DASH office (day trade): the same owner check as /app. Nothing here sends orders. */
export default async function DashPage() {
  if (configured()) {
    try {
      await requireOwner();
    } catch (error) {
      if (error instanceof ApiError && [401, 403].includes(error.status)) redirect("/login");
      throw error;
    }
  }
  return <DashClient connected={configured()} />;
}
