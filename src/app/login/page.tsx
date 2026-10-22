import { redirect } from "next/navigation";
import { Login } from "@/components/login";
import { configured } from "@/lib/env";
import { localDevBypass } from "@/lib/auth";
export default async function LoginPage() {
  if (configured() && (await localDevBypass())) redirect("/app");
  return <Login configured={configured()} />;
}
