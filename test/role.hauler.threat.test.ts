import { describe, it, expect, beforeEach } from "vitest";

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
g.FIND_STRUCTURES = 107;
g.STRUCTURE_SPAWN = "spawn";
g.STRUCTURE_EXTENSION = "extension";
g.STRUCTURE_TOWER = "tower";
g.ERR_NOT_IN_RANGE = -9;
g.OK = 0;

import { runHauler } from "../src/roles/role.hauler";
import { ROLE_HAULER } from "../src/config/config.roles";

let clock = 9000;
let walked: string[] = [];

/**
 * A porter carrying gold home to a keep with no storage. The tower is a little
 * short and another porter is already bringing it more than it needs; the
 * spawn has room.
 */
function porterWith(hostileBody: string[]) {
  clock += 1;
  const roomName = `W48S7-${clock}`;
  const structure = (id: string, structureType: string, free: number, range: number) => ({
    id,
    structureType,
    range,
    store: { energy: 1000 - free, getFreeCapacity: () => free, getUsedCapacity: () => 1000 - free },
  });
  const tower = structure("tower", "tower", 20, 3);
  const spawn = structure("spawn", "spawn", 100, 8);
  const hostile = { owner: { username: "Raider" }, body: hostileBody.map((type) => ({ type, hits: 100 })) };

  const room = {
    name: roomName,
    controller: { my: true, level: 4 },
    energyAvailable: 1100,
    energyCapacityAvailable: 1200,
    memory: { minerContainerIds: ["box"] } as unknown as RoomMemory,
    find: (type: number) =>
      type === g.FIND_STRUCTURES ? [tower, spawn] : type === g.FIND_HOSTILE_CREEPS ? [hostile] : [],
  } as unknown as Room;

  g.Game = {
    time: clock,
    rooms: { [roomName]: room },
    creeps: {
      "Porter Hild": {
        name: "Porter Hild",
        store: { energy: 300 },
        memory: { role: ROLE_HAULER, fillTargetId: "tower", working: true },
      },
    },
    getObjectById: (id: string) => ({ tower, spawn, box: { id: "box" } } as Record<string, unknown>)[id] ?? null,
  };
  g.Memory = { creeps: {}, rooms: { [roomName]: room.memory } };

  return {
    name: "Porter Warin",
    room,
    pos: {
      getRangeTo: (t: { range: number }) => t.range,
      findClosestByPath: <T extends { range: number }>(list: T[]) =>
        [...list].sort((a, b) => a.range - b.range)[0] ?? null,
    },
    store: { energy: 300, getFreeCapacity: () => 0, getUsedCapacity: () => 300 },
    memory: { role: ROLE_HAULER, assignedContainerId: "box", working: true } as unknown as CreepMemory,
    transfer: (t: { range: number }) => (t.range > 1 ? g.ERR_NOT_IN_RANGE : g.OK),
    moveTo: (t: { id: string }) => {
      walked.push(t.id);
      return g.OK;
    },
  } as unknown as Creep;
}

beforeEach(() => {
  walked = [];
});

describe("porter under threat", () => {
  it("leaves a tower another porter is filling when only a scout is about", () => {
    runHauler(porterWith(["move"]));
    expect(walked).toEqual(["spawn"]);
  });

  it("runs to the emptiest tower when a hostile can do harm", () => {
    runHauler(porterWith(["attack", "move"]));
    expect(walked).toEqual(["tower"]);
  });
});
