import { redirect } from "next/navigation";
import { configured } from "@/lib/env";
import { requireOwner, ApiError } from "@/lib/auth";
import { Shell } from "@/components/shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ready = configured();
  if (ready) {
    try {
      await requireOwner();
    } catch (error) {
      if (error instanceof ApiError && [401, 403].includes(error.status))
        redirect("/login");
      throw error;
    }
  }
  return <Shell configured={ready}>{children}</Shell>;
}
