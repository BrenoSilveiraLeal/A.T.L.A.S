import { redirect } from "next/navigation";
import { configured } from "@/lib/env";
import { requireOwner, ApiError } from "@/lib/auth";
import { TvMode } from "@/components/tv-mode";

/** Full-screen trading floor for streaming (OBS → YouTube). Same owner check as /app. */
export default async function TvPage() {
  if (!configured()) redirect("/app");
  try {
    await requireOwner();
  } catch (error) {
    if (error instanceof ApiError && [401, 403].includes(error.status)) redirect("/login");
    throw error;
  }
  return <TvMode />;
}
