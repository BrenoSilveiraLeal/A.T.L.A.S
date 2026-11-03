export const CITY_NIGHT_STORAGE_KEY = "atlas-building-night";
const OFFICE_ENTRY_NIGHT_KEY = "atlas-office-entry-night";

/** Hand off the map's current lighting to the next office route in this tab. */
export function setOfficeEntryNightPreference(night: boolean): void {
  const value = night ? "1" : "0";
  try { localStorage.setItem(CITY_NIGHT_STORAGE_KEY, value); } catch { /* storage blocked */ }
  try { sessionStorage.setItem(OFFICE_ENTRY_NIGHT_KEY, value); } catch { /* storage blocked */ }
}

/** Consume the one-shot map-to-office handoff and keep the shared preference in sync. */
export function consumeOfficeEntryNightPreference(): boolean | null {
  try {
    const value = sessionStorage.getItem(OFFICE_ENTRY_NIGHT_KEY);
    if (value !== "1" && value !== "0") return null;
    sessionStorage.removeItem(OFFICE_ENTRY_NIGHT_KEY);
    try { localStorage.setItem(CITY_NIGHT_STORAGE_KEY, value); } catch { /* storage blocked */ }
    return value === "1";
  } catch {
    return null;
  }
}

export function savedCityNightPreference(): boolean | null {
  try {
    const value = localStorage.getItem(CITY_NIGHT_STORAGE_KEY);
    if (value === "1") return true;
    if (value === "0") return false;
  } catch { /* storage blocked */ }
  return null;
}
