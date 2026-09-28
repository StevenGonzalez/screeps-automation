import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_STRUCTURES = 101;
g.FIND_MY_CREEPS = 107;

import {
  setFillTarget,
  energyClaimedByOthers,
  findHandoffTarget,
  meetIncomingHandoff,
} from "../src/services/services.coordination";
import { findCoreFillTarget } from "../src/services/services.creep.energy";
import { ROLE_BUILDER, ROLE_HAULER, ROLE_UPGRADER } from "../src/config/config.roles";

let clock = 5000;

function pos(x: number) {
  return {
    x,
    y: 10,
    roomName: "W1N1",
    getRangeTo: (o: { pos?: { x: number }; x?: number }) => Math.abs((o.pos?.x ?? o.x ?? 0) - x),
    isNearTo: (o: { pos: { x: number } }) => Math.abs(o.pos.x - x) <= 1,
    findClosestByPath: <T>(list: T[]) => list[0] ?? null,
    findClosestByRange: <T extends { pos: { x: number } }>(list: T[]) =>
      [...list].sort((a, b) => Math.abs(a.pos.x - x) - Math.abs(b.pos.x - x))[0] ?? null,
  };
}

let creeps: Creep[] = [];
let structures: unknown[] = [];

const room = {
  name: "W1N1",
  find: (type: number, opts?: { filter?: (o: unknown) => boolean }) => {
    const list = type === g.FIND_MY_CREEPS ? creeps : type === g.FIND_STRUCTURES ? structures : [];
    return opts?.filter ? list.filter(opts.filter) : list;
  },
};

function makeCreep(name: string, role: string, x: number, energy: number, free: number, working = false) {
  const c = {
    name,
    id: `id-${name}`,
    room,
    spawning: false,
    pos: pos(x),
    memory: { role, working } as CreepMemory,
    store: { energy, getFreeCapacity: () => free },
    moveTo: vi.fn(() => 0),
  } as unknown as Creep;
  creeps.push(c);
  (Game.creeps as Record<string, Creep>)[name] = c;
  return c;
}

function extension(id: string, x: number, free: number) {
  return { id, structureType: "extension", pos: pos(x), store: { getFreeCapacity: () => free } };
}

beforeEach(() => {
  clock += 1;
  creeps = [];
  structures = [];
  g.Game = { time: clock, creeps: {} };
});

describe("fill claims", () => {
  it("counts energy other creeps are bringing, not our own", () => {
    const a = makeCreep("a", ROLE_HAULER, 10, 300, 0);
    const b = makeCreep("b", ROLE_HAULER, 12, 200, 0);
    setFillTarget(a, "ext1");
    setFillTarget(b, "ext1");
    expect(energyClaimedByOthers("ext1", a)).toBe(200);
    setFillTarget(b, "ext2");
    expect(energyClaimedByOthers("ext1", a)).toBe(0);
  });

  it("picks up claims made on an earlier tick from memory", () => {
    const a = makeCreep("a", ROLE_HAULER, 10, 300, 0);
    a.memory.fillTargetId = "ext1";
    const b = makeCreep("b", ROLE_HAULER, 12, 200, 0);
    expect(energyClaimedByOthers("ext1", b)).toBe(300);
  });

  it("sends a second hauler to a different extension", () => {
    structures = [extension("ext1", 11, 50), extension("ext2", 20, 50)];
    const a = makeCreep("a", ROLE_HAULER, 10, 300, 0);
    const b = makeCreep("b", ROLE_HAULER, 10, 300, 0);
    setFillTarget(a, findCoreFillTarget(a)!.id);
    expect(a.memory.fillTargetId).toBe("ext1");
    expect(findCoreFillTarget(b)!.id).toBe("ext2");
  });

  it("still shares a target that needs more than the claimed energy", () => {
    structures = [extension("spawn1", 11, 300)];
    const a = makeCreep("a", ROLE_HAULER, 10, 100, 0);
    const b = makeCreep("b", ROLE_HAULER, 10, 100, 0);
    setFillTarget(a, "spawn1");
    expect(findCoreFillTarget(b)?.id).toBe("spawn1");
  });
});

describe("worker handoff", () => {
  it("picks the closest empty builder in range and skips upgraders", () => {
    const hauler = makeCreep("h", ROLE_HAULER, 10, 500, 0, true);
    makeCreep("up", ROLE_UPGRADER, 11, 0, 50);
    makeCreep("far", ROLE_BUILDER, 30, 0, 50);
    const near = makeCreep("near", ROLE_BUILDER, 14, 0, 50);
    expect(findHandoffTarget(hauler, 10)).toBe(near);
  });

  it("ignores a builder that is already working", () => {
    const hauler = makeCreep("h", ROLE_HAULER, 10, 500, 0, true);
    makeCreep("busy", ROLE_BUILDER, 12, 20, 30, true);
    expect(findHandoffTarget(hauler, 10)).toBeNull();
  });

  it("leaves a builder another hauler already covers", () => {
    const first = makeCreep("h1", ROLE_HAULER, 10, 500, 0, true);
    const second = makeCreep("h2", ROLE_HAULER, 10, 500, 0, true);
    const builder = makeCreep("b", ROLE_BUILDER, 12, 0, 50);
    setFillTarget(first, builder.id);
    expect(findHandoffTarget(second, 10)).toBeNull();
  });

  it("walks the builder to the hauler bringing it energy", () => {
    const hauler = makeCreep("h", ROLE_HAULER, 20, 500, 0, true);
    const builder = makeCreep("b", ROLE_BUILDER, 10, 0, 50);
    expect(meetIncomingHandoff(builder)).toBe(false);
    setFillTarget(hauler, builder.id);
    expect(meetIncomingHandoff(builder)).toBe(true);
    expect(builder.moveTo).toHaveBeenCalledWith(hauler, { range: 1, reusePath: 5 });
  });

  it("stops waiting once the hauler is empty", () => {
    const hauler = makeCreep("h", ROLE_HAULER, 20, 0, 500, true);
    const builder = makeCreep("b", ROLE_BUILDER, 10, 0, 50);
    setFillTarget(hauler, builder.id);
    expect(meetIncomingHandoff(builder)).toBe(false);
  });
});
