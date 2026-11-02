import { redirect } from "next/navigation";
import { Login } from "@/components/login";
import { configured } from "@/lib/env";
import { localDevBypass } from "@/lib/auth";
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next: requestedNext } = await searchParams;
  // Only office entry points are valid post-auth destinations; never accept an external URL.
  const next = requestedNext === "/daytrade" ? "/daytrade" : "/app";
  if (configured() && (await localDevBypass())) redirect(next);
  return <Login configured={configured()} next={next} />;
}
