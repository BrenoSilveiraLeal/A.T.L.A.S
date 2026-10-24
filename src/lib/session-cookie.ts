/**
 * "Lembrar de mim": with the remember cookie the Supabase session cookies live 30 days instead of
 * one hour, so the owner skips password and authenticator on that device. Shared by the proxy
 * (edge) and the server client, so it has no server-only imports.
 */
export const REMEMBER_COOKIE = "atlas_remember";
export const REMEMBER_SECONDS = 30 * 86400;
export const SESSION_SECONDS = 3600;
export const sessionMaxAge = (remember: boolean) => (remember ? REMEMBER_SECONDS : SESSION_SECONDS);
