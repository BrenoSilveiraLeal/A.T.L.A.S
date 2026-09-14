// Supabase Edge Function. No database or broker credentials in the request body.
Deno.serve(async (request: Request) => {
  const secret = Deno.env.get("CRON_SECRET");
  const base = Deno.env.get("ATLAS_APP_URL");
  if (!secret || !base) return new Response("Scheduler not configured", { status: 503 });
  if (request.method !== "POST" || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const destination = new URL("/api/cron", base);
  if (destination.protocol !== "https:") return new Response("HTTPS required", { status: 503 });
  try {
    const response = await fetch(destination, {
      method: "POST", headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(55000), redirect: "error",
    });
    // The upstream response contains only IDs/status; do not echo headers or secrets.
    return new Response(await response.text(), { status: response.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch {
    // A timeout leaves persisted leases to expire. Never send any broker order here.
    return new Response('{"error":"UPSTREAM_UNAVAILABLE"}', { status: 503, headers: { "content-type": "application/json" } });
  }
});
