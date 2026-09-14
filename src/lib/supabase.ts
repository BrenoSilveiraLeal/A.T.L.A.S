import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { required, secureCookies } from "./env";

export async function sessionClient() {
  const jar = await cookies();
  return createServerClient(required("SUPABASE_URL"), required("SUPABASE_PUBLISHABLE_KEY"), {
    cookieOptions: { httpOnly: true, secure: secureCookies(), sameSite: "strict", path: "/", maxAge: 3600 },
    cookies: {
      getAll: () => jar.getAll(),
      setAll(values) {
        try { values.forEach(({ name, value, options }) => jar.set(name, value, { ...options, httpOnly: true, secure: secureCookies(), sameSite: "strict", maxAge: options.maxAge === 0 ? 0 : 3600 })); }
        catch { /* Server Components cannot set cookies; proxy refreshes them. */ }
      },
    },
  });
}

// Service credentials stay inside the backend. Every caller must authorize first.
export function adminClient() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
