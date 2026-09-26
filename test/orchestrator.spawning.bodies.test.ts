import { describe, it, expect } from "vitest";

const g = globalThis as Record<string, unknown>;

g.WORK = "work";
g.CARRY = "carry";
g.MOVE = "move";
g.ATTACK = "attack";
g.RANGED_ATTACK = "ranged_attack";
g.HEAL = "heal";
g.TOUGH = "tough";
g.CLAIM = "claim";
g.BODYPART_COST = {
  work: 100,
  carry: 50,
  move: 50,
  attack: 80,
  ranged_attack: 150,
  heal: 250,
  tough: 10,
  claim: 600,
};

import {
  buildKnightBody,
  buildWizardBody,
  buildClericBody,
  buildDrainerBody,
  buildSiegerBody,
  buildSkGuardianBody,
} from "../src/orchestrators/orchestrator.spawning";

/**
 * Damage consumes body parts left to right. TOUGH soaks first, then the damage
 * parts, then MOVE, then HEAL: a hurt creep that can still move and heal gets
 * home, while one that lost its MOVE first is stranded and lost.
 */
const RANK: Record<string, number> = {
  tough: 0,
  work: 1,
  attack: 1,
  ranged_attack: 1,
  move: 2,
  heal: 3,
};

function isOrderedWorstToBest(body: string[]): boolean {
  for (let i = 1; i < body.length; i++) {
    if (RANK[body[i]] < RANK[body[i - 1]]) return false;
  }
  return true;
}

const ENERGIES = [300, 800, 1300, 2300, 12_900];

describe("combat body part ordering", () => {
  const builders: Record<string, (energy: number) => string[]> = {
    knight: buildKnightBody as unknown as (e: number) => string[],
    wizard: buildWizardBody as unknown as (e: number) => string[],
    cleric: buildClericBody as unknown as (e: number) => string[],
    drainer: buildDrainerBody as unknown as (e: number) => string[],
    sieger: buildSiegerBody as unknown as (e: number) => string[],
    skGuardian: buildSkGuardianBody as unknown as (e: number) => string[],
  };

  for (const [name, build] of Object.entries(builders)) {
    it(`${name} orders TOUGH, damage, MOVE, HEAL at every body size`, () => {
      for (const energy of ENERGIES) {
        const body = build(energy);
        expect(body.length).toBeGreaterThan(0);
        expect(isOrderedWorstToBest(body), `${name} @ ${energy}: ${body.join(",")}`).toBe(
          true
        );
      }
    });
  }

  it("keeps the drainer healing after its TOUGH and MOVE parts are gone", () => {
    const body = buildDrainerBody(2300);
    const lastTough = body.lastIndexOf(g.TOUGH as string);
    const firstHeal = body.indexOf(g.HEAL as string);
    expect(lastTough).toBeLessThan(firstHeal);
    expect(body[body.length - 1]).toBe(g.HEAL);
  });

  it("keeps the sieger mobile after its TOUGH and WORK parts are gone", () => {
    const body = buildSiegerBody(2300);
    expect(body[body.length - 1]).toBe(g.MOVE);
  });
});
