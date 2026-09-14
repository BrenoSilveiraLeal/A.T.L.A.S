import "server-only";

export function configured() {
  return Boolean(
    process.env.SUPABASE_URL &&
      process.env.SUPABASE_PUBLISHABLE_KEY &&
      process.env.ATLAS_OWNER_ID,
  );
}
export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`CONFIGURATION_MISSING:${name}`);
  return value;
}
export function secureCookies() {
  return (
    process.env.SESSION_COOKIE_SECURE !== "false" &&
    process.env.NODE_ENV === "production"
  );
}
