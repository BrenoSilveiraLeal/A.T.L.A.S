/**
 * How each agent appears in the office (owner, 24/10/2026: each AI is shown as a person, with a
 * look that matches the owner's choice for that name).
 * The look is set here per agent name; a new agent gets a neutral look until the owner picks one.
 */
export type HairStyle = "short" | "buzz" | "curly" | "long" | "bun" | "ponytail";
export interface PersonLook {
  presentation: "feminine" | "masculine" | "neutral";
  skin: string; hair: string; hairStyle: HairStyle;
  shirt: string; pants: string; skirt?: boolean;
  /** Jacket worn open over the shirt, and glasses. */
  jacket?: string; glasses?: boolean;
}

export const PEOPLE: Record<string, PersonLook> = {
  Maria: { presentation: "feminine", skin: "#c68863", hair: "#2b1a12", hairStyle: "long", shirt: "#e8543a", pants: "#2d3142" },
  "João": { presentation: "masculine", skin: "#e0b08b", hair: "#4a3020", hairStyle: "short", shirt: "#dfe8f5", pants: "#3b3f4a", jacket: "#2f4a7a" },
  Ana: { presentation: "feminine", skin: "#f1c6a5", hair: "#8a4b23", hairStyle: "bun", shirt: "#f2a541", pants: "#26324a", skirt: true, glasses: true },
  Rafa: { presentation: "masculine", skin: "#8d5a3b", hair: "#120c08", hairStyle: "curly", shirt: "#22a06b", pants: "#2a2d34" },
  Davi: { presentation: "masculine", skin: "#d9a07a", hair: "#1d1410", hairStyle: "buzz", shirt: "#7c4dcc", pants: "#33363d", glasses: true },
  Sofia: { presentation: "feminine", skin: "#e8b896", hair: "#d9a441", hairStyle: "ponytail", shirt: "#1fa3b8", pants: "#2b2f3a" },
  // Hired 26/10/2026 when the office grew to twelve desks.
  Beatriz: { presentation: "feminine", skin: "#a8714f", hair: "#1a110c", hairStyle: "curly", shirt: "#d6336c", pants: "#2a2e38" },
  Lucas: { presentation: "masculine", skin: "#f0c9a8", hair: "#6b4a2b", hairStyle: "short", shirt: "#f4f4f4", pants: "#2f3440", jacket: "#b02525" },
  Clara: { presentation: "feminine", skin: "#f5d3b8", hair: "#b5651d", hairStyle: "long", shirt: "#e8eef7", pants: "#23262e", skirt: true, jacket: "#1c4e9c" },
  Gabriel: { presentation: "masculine", skin: "#c48a62", hair: "#2a1d14", hairStyle: "buzz", shirt: "#f08c00", pants: "#363a44", glasses: true },
  Helena: { presentation: "feminine", skin: "#7a4a32", hair: "#0f0a08", hairStyle: "bun", shirt: "#f1ecff", pants: "#2b2f3a", jacket: "#7048e8" },
  Thiago: { presentation: "masculine", skin: "#dba982", hair: "#3b2a1c", hairStyle: "curly", shirt: "#e9f5ec", pants: "#30343c", jacket: "#2b8a3e" },
  // Hired 27/10/2026 when the team grew to sixteen.
  Laura: { presentation: "feminine", skin: "#e9bc98", hair: "#4a2a16", hairStyle: "long", shirt: "#f2f2f2", pants: "#2b2f3a", jacket: "#e8590c" },
  Pedro: { presentation: "masculine", skin: "#b07a55", hair: "#1a120c", hairStyle: "short", shirt: "#1864ab", pants: "#30343c", glasses: true },
  Fernanda: { presentation: "feminine", skin: "#8a5a3c", hair: "#120c08", hairStyle: "ponytail", shirt: "#0ca678", pants: "#2a2e38", skirt: true },
  Mateus: { presentation: "masculine", skin: "#f1cdb0", hair: "#7a5230", hairStyle: "curly", shirt: "#f4f4f4", pants: "#2f3440", jacket: "#364fc7" },
};

const NEUTRAL_SHIRTS = ["#5c6bc0", "#26a69a", "#ef6c00", "#8d6e63", "#546e7a"];

export function lookFor(name: string, id: string): PersonLook {
  const known = PEOPLE[name];
  if (known) return known;
  const h = [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return { presentation: "neutral", skin: "#d4a27f", hair: "#3a2a20", hairStyle: "short",
    shirt: NEUTRAL_SHIRTS[h % NEUTRAL_SHIRTS.length], pants: "#30343c" };
}
