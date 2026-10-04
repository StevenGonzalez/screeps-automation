// What each of the realm's people looks like. Our own are known by the title
// in their names, "Mason Aldric" or "Dragon Knight Ysolde" (see ROLE_TITLES in
// config.roles), and each title is dressed and armed for its trade. Strangers
// carry no title we trust, so they are geared by what their bodies are built
// for: a sword for attack parts, a bow for ranged, a staff for heal. The
// realm's old enemies have looks of their own: Invaders come as raiders, and
// Source Keepers as hulking trolls.
//
// Nothing here draws: figures.ts paints a look. Kept apart so it can be tested
// without a canvas.

import { INVADER, SOURCE_KEEPER, type RoomObject } from "../shared/realm";

export type Hat =
  | "none"
  | "hood"
  | "cap"
  | "feather-cap"
  | "miner"
  | "plume-helm"
  | "crown-helm"
  | "wizard"
  | "coif"
  | "pilgrim"
  | "horned"
  | "galea"
  | "turban"
  | "kettle"
  | "mask-hood"
  | "crown";

// What is held in the near hand, the one towards the viewer.
export type Tool =
  | "none"
  | "hammer"
  | "mallet"
  | "pickaxe"
  | "staff"
  | "orb-staff"
  | "skull-staff"
  | "tankard"
  | "sword"
  | "greatsword"
  | "longbow"
  | "lance"
  | "lute"
  | "banner"
  | "censer"
  | "potion"
  | "dagger"
  | "axe"
  | "greataxe"
  | "maul"
  | "club"
  | "flail"
  | "trident"
  | "chisel"
  | "scroll";

// What the far hand carries, or what is worn before the body.
export type Off = "none" | "kite-shield" | "round-shield" | "buckler" | "lantern" | "torch" | "potion" | "scroll" | "gold-sack" | "gems";

// What is carried on the back.
export type Back = "none" | "sack" | "pack" | "hod" | "quiver" | "bundle" | "basket" | "big-pack" | "loot";

// A light the figure carries: where on the figure it burns, and whether only
// after dark (a torch is lit at nightfall; a miner's lamp always burns).
export interface Glow {
  at: "head" | "tool" | "off" | "chest";
  colour: string;
  r: number;
  power: number;
  dark?: boolean;
}

// Colours that are worked out per figure: VARY picks a skin or hair colour
// from the bearer's name, SKIN is bare skin (a bare chest, bare arms), and
// ARMS and ARMS2 are the castle's field and other colours (services.heraldry).
export const VARY = "vary";
export const SKIN = "skin";
export const ARMS = "arms";
export const ARMS2 = "arms2";

export interface Look {
  kind: "person" | "bird" | "mule";
  // 1 is a grown man, about three quarters of a tile tall.
  size: number;
  skin: string;
  // Null where the head is shaved or wholly covered.
  hair: string | null;
  // How likely the bearer is to have a beard.
  beard: number;
  ears?: "pointed";
  tusks?: boolean;
  // Eyes that glow, for those whose eyes should be seen in the dark.
  eyes?: string;
  shirt: string;
  // The arms' colour where it is not the shirt's: bare arms, or plate.
  sleeves?: string;
  legs: string;
  boots: string;
  // A robe or a dress to the ankles, instead of hose.
  robe?: boolean;
  apron?: string;
  // A herald's tabard in the castle's arms.
  tabard?: boolean;
  armour?: "plate" | "mail" | "leather";
  trim?: string;
  belt?: string;
  cape?: string;
  hat: Hat;
  hatColour: string;
  hand: Tool;
  off: Off;
  back: Back;
  // Where what it carries shows: a sack on the back filling up, a sack in the
  // hand, or a purse at the belt.
  carry: "back" | "off" | "belt" | "hand";
  glow?: Glow;
  // How far it stoops forward, in radians.
  stoop?: number;
  // Floats above the ground over a ring of runes: the realm's power creeps.
  hover?: boolean;
  bird?: "raven" | "pigeon";
  // What it looses when it shoots.
  missile?: "arrow" | "bolt" | "fire";
}

const WOOL = "#7a6a52";
const HOSE = "#4f4033";
const BOOTS = "#3a2a1e";
const LEATHER = "#6b4a2e";
const DARK_LEATHER = "#4a3220";
const LINEN = "#d9d2bf";
const STEEL = "#9aa3ad";
const IRON = "#5d6066";
const GOLD = "#c9a24a";

function person(look: Partial<Look>): Look {
  return {
    kind: "person",
    size: 1,
    skin: VARY,
    hair: VARY,
    beard: 0,
    shirt: WOOL,
    legs: HOSE,
    boots: BOOTS,
    hat: "none",
    hatColour: "#5a4a3a",
    hand: "none",
    off: "none",
    back: "none",
    carry: "belt",
    ...look,
  };
}

const MINER_LAMP: Glow = { at: "head", colour: "#ffe2a0", r: 2.6, power: 0.9 };
const NIGHT_TORCH: Glow = { at: "off", colour: "#ff9a3c", r: 3, power: 1, dark: true };

/** Every title's look, by the title as it is written in a creep's name. */
export const LOOKS: Record<string, Look> = {
  Mason: person({ shirt: "#8a8170", apron: LEATHER, hat: "cap", hatColour: "#6d6352", hand: "mallet", back: "hod", beard: 0.4 }),
  Villager: person({ shirt: "#5f6a35", legs: "#5a4632", hand: "pickaxe", back: "basket", carry: "back", beard: 0.3 }),
  Enchanter: person({
    shirt: "#33405f",
    robe: true,
    trim: GOLD,
    hat: "wizard",
    hatColour: "#33405f",
    hand: "orb-staff",
    beard: 0.6,
    glow: { at: "tool", colour: "#c9a0ff", r: 1.8, power: 0.55 },
  }),
  Blacksmith: person({ shirt: "#3d3530", sleeves: SKIN, apron: DARK_LEATHER, hair: null, beard: 0.9, hand: "hammer", size: 1.06 }),
  Miner: person({ shirt: "#6a5f50", legs: "#463b30", hat: "miner", hatColour: "#8a7a52", hand: "pickaxe", beard: 0.5, glow: MINER_LAMP }),
  Porter: person({ shirt: "#9a7a3e", hat: "cap", hatColour: "#6a5432", back: "sack", carry: "back", stoop: 0.12 }),
  Barmaid: person({ shirt: "#7e2f34", robe: true, apron: LINEN, hat: "coif", hatColour: LINEN, hand: "tankard", carry: "hand" }),
  Jeweler: person({ shirt: "#3a5444", trim: GOLD, legs: "#3a3226", hat: "feather-cap", hatColour: "#24453a", hand: "chisel", off: "gems", carry: "off" }),
  Raven: { ...person({}), kind: "bird", bird: "raven", size: 1 },
  Peddler: person({ shirt: "#7a5a3a", hat: "pilgrim", hatColour: "#5a4630", hand: "pickaxe", back: "pack", beard: 0.5 }),
  Merchant: person({ shirt: "#34524c", trim: "#c9b48a", hat: "feather-cap", hatColour: "#5a1f2a", off: "gold-sack", carry: "off", beard: 0.4, size: 1.04 }),
  Envoy: person({ tabard: true, shirt: ARMS, legs: ARMS2, hat: "feather-cap", hatColour: ARMS, hand: "banner", off: "scroll" }),
  "Dragon Knight": person({
    armour: "plate",
    shirt: STEEL,
    sleeves: STEEL,
    legs: STEEL,
    boots: IRON,
    cape: ARMS,
    hat: "plume-helm",
    hatColour: ARMS,
    hand: "sword",
    off: "kite-shield",
    size: 1.05,
  }),
  "Dark Wizard": person({
    shirt: "#2a1f33",
    robe: true,
    trim: "#6f4a8f",
    hat: "wizard",
    hatColour: "#1d1626",
    hand: "skull-staff",
    beard: 0.7,
    eyes: "#9cff7a",
    missile: "bolt",
    glow: { at: "tool", colour: "#8cff6b", r: 2, power: 0.6 },
  }),
  Cleric: person({ shirt: "#d2c9b4", robe: true, trim: GOLD, hat: "hood", hatColour: "#d2c9b4", hand: "censer", glow: { at: "tool", colour: "#ffe9a8", r: 1.6, power: 0.5 } }),
  Ravager: person({ armour: "plate", shirt: "#3b3a3a", sleeves: "#3b3a3a", legs: "#2e2a26", boots: IRON, hat: "horned", hatColour: IRON, hand: "maul", size: 1.14, beard: 0.8 }),
  Gladiator: person({ shirt: SKIN, sleeves: SKIN, legs: "#7a2a22", apron: "#8a3328", hat: "galea", hatColour: "#b0813c", hand: "trident", off: "round-shield", size: 1.04 }),
  "Dark Lord": person({
    armour: "plate",
    shirt: "#26222a",
    sleeves: "#26222a",
    legs: "#1d1a20",
    boots: "#151316",
    cape: "#6a1420",
    hat: "crown-helm",
    hatColour: "#1d1a20",
    hand: "greatsword",
    eyes: "#ff4a3d",
    size: 1.12,
  }),
  Pilgrim: person({ shirt: "#6e5a44", robe: true, hat: "pilgrim", hatColour: "#4e3e2c", hand: "staff", back: "bundle", beard: 0.6, glow: NIGHT_TORCH, off: "torch" }),
  Goblin: person({ skin: "#6f8f3a", hair: null, ears: "pointed", shirt: "#5a4a32", legs: "#3e3424", hand: "potion", size: 0.72, glow: { at: "tool", colour: "#9cff7a", r: 1, power: 0.4 } }),
  Reaver: person({ armour: "plate", shirt: "#2b2424", sleeves: "#2b2424", legs: "#231d1d", boots: "#1a1515", hat: "horned", hatColour: "#2b2424", hand: "greataxe", eyes: "#ff6a3d", size: 1.08 }),
  Acolyte: person({ shirt: "#5a4a6e", robe: true, trim: "#c9b48a", hat: "hood", hatColour: "#5a4a6e", hand: "orb-staff", glow: { at: "tool", colour: "#ffd6f0", r: 1.6, power: 0.5 } }),
  Looter: person({ shirt: "#3a3430", legs: "#2a2622", hat: "mask-hood", hatColour: "#262220", hand: "dagger", back: "loot", carry: "back", stoop: 0.1 }),
  Nomad: person({ shirt: "#c2a272", robe: true, hat: "turban", hatColour: "#e0d0a8", hand: "pickaxe", beard: 0.6 }),
  Caravan: person({ shirt: "#a8763e", robe: true, hat: "turban", hatColour: "#8a2f2a", back: "big-pack", carry: "back", off: "lantern", stoop: 0.14, glow: { at: "off", colour: "#ffc46b", r: 2.4, power: 0.8, dark: true } }),
  Lancer: person({ armour: "mail", shirt: "#7d8088", sleeves: "#7d8088", tabard: true, hat: "kettle", hatColour: IRON, hand: "lance", off: "kite-shield", size: 1.04 }),
  Delver: person({ shirt: "#4a4440", legs: "#36302a", hat: "miner", hatColour: "#5a5a5a", hand: "pickaxe", beard: 0.7, glow: MINER_LAMP }),
  Packmule: { ...person({}), kind: "mule", size: 1, carry: "back" },
  Seeker: person({ shirt: "#3a4a5a", hat: "hood", hatColour: "#2e3a46", hand: "staff", off: "lantern", glow: { at: "off", colour: "#ffd27a", r: 2.4, power: 0.8 } }),
  Usurper: person({ shirt: "#2a2430", cape: "#3a1830", hat: "hood", hatColour: "#1f1a24", hand: "dagger", off: "none", eyes: "#d8b0ff" }),
  Yeoman: person({ shirt: "#4a5a2a", armour: "leather", legs: "#3e3a2a", hat: "hood", hatColour: "#34502f", hand: "longbow", back: "quiver", missile: "arrow" }),
  Minstrel: person({ shirt: "#8e3a30", trim: GOLD, legs: "#b08a42", hat: "feather-cap", hatColour: "#34466a", hand: "lute" }),
};

const BIRD: Look = { ...person({}), kind: "bird", bird: "pigeon" };

// A second of a name: "Edric II".
const ORDINAL = /^[IVXLC]+$/;
// The tick a recruit was named on, in place of a given name, when every given
// name was taken: "Mason 74114851".
const TICK = /^\d+$/;

/**
 * The title in a creep's name: everything before its given name. "Mason
 * Aldric" is a Mason, "Dragon Knight Edric II" a Dragon Knight, and "Mason
 * 74114851" a Mason too.
 */
export function creepTitle(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length > 1 && TICK.test(words[words.length - 1])) return words.slice(0, -1).join(" ");
  while (words.length > 2 && ORDINAL.test(words[words.length - 1])) words.pop();
  return words.slice(0, -1).join(" ");
}

function parts(o: RoomObject): Record<string, number> {
  const out: Record<string, number> = {};
  if (Array.isArray(o.body)) for (const p of o.body) if (p && typeof p.type === "string") out[p.type] = (out[p.type] ?? 0) + 1;
  return out;
}

// Geared for what the body is built for, the strongest kind first.
function geared(o: RoomObject, base: Look, raider: boolean): Look {
  const n = parts(o);
  const look: Look = { ...base };
  if ((n.tough ?? 0) > 0) look.armour = raider ? "leather" : "mail";
  if ((n.claim ?? 0) > 0) {
    look.hand = "banner";
  } else if ((n.heal ?? 0) > (n.attack ?? 0) && (n.heal ?? 0) > (n.ranged_attack ?? 0)) {
    look.hand = raider ? "skull-staff" : "orb-staff";
    look.robe = true;
    look.glow = { at: "tool", colour: raider ? "#9cff7a" : "#ffe9a8", r: 1.5, power: 0.45 };
  } else if ((n.ranged_attack ?? 0) > (n.attack ?? 0)) {
    look.hand = "longbow";
    look.back = "quiver";
    look.missile = "arrow";
  } else if ((n.attack ?? 0) > 0) {
    look.hand = raider ? "axe" : "sword";
    look.off = raider ? "round-shield" : "buckler";
  } else if ((n.work ?? 0) > 0) {
    look.hand = "pickaxe";
  } else if ((n.carry ?? 0) > 0) {
    look.back = "sack";
    look.carry = "back";
  }
  return look;
}

// Strangers wear the colours of the enemy: oxblood and black iron.
const STRANGER = person({ shirt: "#6b1d1d", legs: "#2a2020", boots: "#1a1414", hat: "hood", hatColour: "#241a1a", beard: 0.5 });
const RAIDER = person({ skin: "#a87a5a", shirt: "#4a2a1a", legs: "#3a2418", hat: "horned", hatColour: IRON, beard: 0.8, eyes: "#ff5a3a", cape: "#5a1a14" });
const TROLL = person({
  skin: "#7d8a6a",
  hair: null,
  ears: "pointed",
  tusks: true,
  eyes: "#ffd24a",
  shirt: "#7d8a6a",
  sleeves: "#7d8a6a",
  legs: "#7d8a6a",
  boots: "#5d684e",
  apron: "#5a4632",
  hand: "club",
  size: 1.45,
  stoop: 0.28,
});
const ARCHMAGE = person({
  shirt: "#1f2a5a",
  robe: true,
  trim: GOLD,
  cape: "#2a3a7a",
  hat: "crown",
  hatColour: GOLD,
  hand: "orb-staff",
  hover: true,
  beard: 0.7,
  glow: { at: "tool", colour: "#9fc4ff", r: 2.2, power: 0.7 },
});
const DARK_ARCHMAGE = { ...ARCHMAGE, shirt: "#4a1420", cape: "#2a0a10", trim: "#8a2a2a", glow: { at: "tool" as const, colour: "#ff6a5a", r: 2.2, power: 0.7 } };

/** The look of a creep or power creep, `mine` if it is ours. */
export function lookOf(o: RoomObject, mine: boolean): Look {
  if (o.type === "powerCreep") return mine ? ARCHMAGE : DARK_ARCHMAGE;
  if (o.user === SOURCE_KEEPER) return TROLL;
  if (o.user === INVADER) return geared(o, RAIDER, true);
  if (!mine) return geared(o, STRANGER, false);
  return LOOKS[creepTitle(String(o.name ?? ""))] ?? BIRD;
}
