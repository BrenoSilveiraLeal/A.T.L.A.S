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
}

export const PEOPLE: Record<string, PersonLook> = {
  Maria: { presentation: "feminine", skin: "#c68863", hair: "#2b1a12", hairStyle: "long", shirt: "#e8543a", pants: "#2d3142" },
  "João": { presentation: "masculine", skin: "#e0b08b", hair: "#4a3020", hairStyle: "short", shirt: "#2f6fd6", pants: "#3b3f4a" },
  Ana: { presentation: "feminine", skin: "#f1c6a5", hair: "#8a4b23", hairStyle: "bun", shirt: "#f2a541", pants: "#26324a", skirt: true },
  Rafa: { presentation: "masculine", skin: "#8d5a3b", hair: "#120c08", hairStyle: "curly", shirt: "#22a06b", pants: "#2a2d34" },
  Davi: { presentation: "masculine", skin: "#d9a07a", hair: "#1d1410", hairStyle: "buzz", shirt: "#7c4dcc", pants: "#33363d" },
  Sofia: { presentation: "feminine", skin: "#e8b896", hair: "#d9a441", hairStyle: "ponytail", shirt: "#1fa3b8", pants: "#2b2f3a" },
};

const NEUTRAL_SHIRTS = ["#5c6bc0", "#26a69a", "#ef6c00", "#8d6e63", "#546e7a"];

export function lookFor(name: string, id: string): PersonLook {
  const known = PEOPLE[name];
  if (known) return known;
  const h = [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return { presentation: "neutral", skin: "#d4a27f", hair: "#3a2a20", hairStyle: "short",
    shirt: NEUTRAL_SHIRTS[h % NEUTRAL_SHIRTS.length], pants: "#30343c" };
}
