import type { Metadata } from "next";
import { OwnerSetupForm } from "@/components/owner-setup-form";
import { configured } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Primeiro acesso | ATLAS",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function SetupPage() {
  return <OwnerSetupForm configured={configured()} />;
}
