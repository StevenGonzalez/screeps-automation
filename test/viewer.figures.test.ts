import { describe, expect, it } from "vitest";
import { ROLE_TITLES } from "../src/config/config.roles";
import { walk } from "../viewer/client/figures";
import { creepTitle, lookOf, LOOKS } from "../viewer/client/figures-looks";
import { INVADER, SOURCE_KEEPER } from "../viewer/shared/realm";

function creep(name: string, user: string, parts: string[] = []) {
  return { type: "creep", name, user, body: parts.map((type) => ({ type, hits: 100 })) };
}

describe("viewer figures", () => {
  it("reads the title in a creep's name, past a second of the name or a tick", () => {
    expect(creepTitle("Mason Aldric")).toBe("Mason");
    expect(creepTitle("Dragon Knight Edric II")).toBe("Dragon Knight");
    expect(creepTitle("Mason 74114851")).toBe("Mason");
    expect(creepTitle("Pigeon")).toBe("");
  });

  it("has a look for every title the castle names its people by", () => {
    const missing = Object.values(ROLE_TITLES).filter((title) => !LOOKS[title]);
    expect(missing).toEqual([]);
  });

  it("dresses our own by their title and anything untitled as a bird", () => {
    expect(lookOf(creep("Mason Aldric", "me"), true)).toBe(LOOKS.Mason);
    expect(lookOf(creep("Mason 74114851", "me"), true)).toBe(LOOKS.Mason);
    expect(lookOf(creep("Pigeon", "me"), true).kind).toBe("bird");
  });

  it("gears strangers and raiders by what their bodies are built for", () => {
    expect(lookOf(creep("x", "foe", ["attack", "move"]), false).hand).toBe("sword");
    expect(lookOf(creep("x", "foe", ["ranged_attack", "move"]), false).hand).toBe("longbow");
    expect(lookOf(creep("x", "foe", ["claim", "move"]), false).hand).toBe("banner");
    expect(lookOf(creep("x", "foe", ["tough", "heal", "heal", "move"]), false)).toMatchObject({ hand: "orb-staff", armour: "mail" });
    expect(lookOf(creep("x", INVADER, ["attack", "move"]), false)).toMatchObject({ hand: "axe", hat: "horned" });
    expect(lookOf(creep("x", INVADER, ["heal", "move"]), false).hand).toBe("skull-staff");
  });

  it("knows the realm's old enemies and its power creeps on sight", () => {
    expect(lookOf(creep("Keeper", SOURCE_KEEPER, ["attack"]), false)).toMatchObject({ tusks: true, hand: "club" });
    const ours = lookOf({ type: "powerCreep", name: "Archmage", user: "me" }, true);
    const theirs = lookOf({ type: "powerCreep", name: "Archmage", user: "foe" }, false);
    expect(ours.hover).toBe(true);
    expect(theirs.hover).toBe(true);
    expect(theirs.shirt).not.toBe(ours.shirt);
  });

  it("keeps a figure stepping diagonally north turned to the side, and one stepping north turned away", () => {
    // A room far out on shard1, where world tiles are large numbers.
    const ox = 97550;
    const oy = 400;
    const turns = (key: string, sx: number) => {
      const seen = new Set<boolean>();
      for (let step = 0; step < 4; step++) {
        for (let ms = 0; ms <= 2700; ms += 1000 / 60) {
          const t = ms / 2700;
          const g = walk(key, ox + 10 + sx * (step + t), oy + 30 - (step + t), step * 3000 + ms, 1);
          if (g.stride > 0) seen.add(g.back);
        }
      }
      return [...seen];
    };
    expect(turns("diagonal", 1)).toEqual([false]);
    expect(turns("north", 0)).toEqual([true]);
  });
});
