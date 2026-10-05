import { describe, it, expect, vi, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.ATTACK = "attack";
g.RANGED_ATTACK = "ranged_attack";
g.HEAL = "heal";
g.TOUGH = "tough";
g.MOVE = "move";
g.WORK = "work";
g.ATTACK_POWER = 30;
g.RANGED_ATTACK_POWER = 10;
g.HEAL_POWER = 12;
g.DISMANTLE_POWER = 50;
g.FIND_HOSTILE_CREEPS = 113;

const footing: boolean[] = [];
vi.mock("../src/roles/role.tower", () => ({
  selectRoomAttackTarget: () => null,
  runTower: (_tower: unknown, _target: unknown, hasHostiles: boolean) => footing.push(hasHostiles),
}));

import { loop } from "../src/orchestrators/orchestrator.tower";

let clock = 100;

function roomWith(body: string[]) {
  clock += 1;
  const hostile = { owner: { username: "Raider" }, body: body.map((type) => ({ type, hits: 100 })) };
  const room = {
    name: "W48S7",
    controller: { my: true, safeModeAvailable: 0 },
    memory: { towerIds: ["tower"] },
    find: (type: number) => (type === g.FIND_HOSTILE_CREEPS ? [hostile] : []),
  };
  g.Game = {
    time: clock,
    rooms: { W48S7: room },
    getObjectById: (id: string) => (id === "tower" ? { id } : null),
    notify: () => undefined,
  };
  g.Memory = { threatNotifyLastTick: { W48S7: clock } };
}

beforeEach(() => {
  footing.length = 0;
});

describe("tower war footing", () => {
  it("stays at peace while only a scout is in the room", () => {
    roomWith(["move"]);
    loop();
    expect(footing).toEqual([false]);
  });

  it("goes to war for a hostile that can do harm", () => {
    roomWith(["attack", "move"]);
    loop();
    expect(footing).toEqual([true]);
  });
});
