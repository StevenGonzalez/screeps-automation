import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.OK = 0;
g.CLAIM = "claim";
g.MOVE = "move";
g.BODYPART_COST = { claim: 600, move: 50 };
g.CONTROLLER_ATTACK_BLOCKED_UPGRADE = 1000;
g.RoomPosition = class {
  constructor(public x: number, public y: number, public roomName: string) {}
};

const { findUnclaimTarget, buildUnclaimerBody } = await import(
  "../src/orchestrators/orchestrator.spawning"
);
const { runUnclaimer } = await import("../src/roles/role.unclaimer");
const { ROLE_UNCLAIMER } = await import("../src/config/config.roles");

let clock = 50_000;
const home = { name: "W1N1" } as unknown as Room;

function setGame(creeps: Record<string, unknown> = {}) {
  clock += 1;
  g.Game = { time: clock, creeps };
}

beforeEach(() => {
  g.Memory = { creeps: {}, rooms: {} };
});

describe("unclaimer spawning", () => {
  it("targets a queued room once its controller is nearly attackable", () => {
    setGame();
    (g.Memory as Memory).unclaimTargets = {
      W2N1: { homeRoom: "W1N1", until: clock + 5000, blockedUntil: clock + 1000 },
    };
    expect(findUnclaimTarget(home)).toBeNull();
    (g.Memory as Memory).unclaimTargets!.W2N1.blockedUntil = clock + 300;
    expect(findUnclaimTarget(home)).toBe("W2N1");
  });

  it("does not double up and drops expired targets", () => {
    setGame({ u1: { memory: { role: ROLE_UNCLAIMER, targetRoom: "W2N1" } } });
    (g.Memory as Memory).unclaimTargets = {
      W2N1: { homeRoom: "W1N1", until: clock + 5000 },
      W3N1: { homeRoom: "W1N1", until: clock },
    };
    expect(findUnclaimTarget(home)).toBeNull();
    expect((g.Memory as Memory).unclaimTargets!.W3N1).toBeUndefined();
  });

  it("packs as many CLAIM parts as capacity allows", () => {
    expect(buildUnclaimerBody(5600).filter((p) => p === "claim")).toHaveLength(8);
    expect(buildUnclaimerBody(12_900).filter((p) => p === "claim")).toHaveLength(19);
  });
});

describe("unclaimer role", () => {
  function unclaimer(controller: Record<string, unknown>) {
    const calls: string[] = [];
    const creep = {
      memory: { targetRoom: "W2N1" },
      room: { name: "W2N1", controller },
      pos: { isNearTo: () => true },
      attackController: () => {
        calls.push("attack");
        return 0;
      },
      moveTo: () => calls.push("move"),
      suicide: () => calls.push("suicide"),
    } as unknown as Creep;
    return { creep, calls };
  }

  it("hits an owned controller once, records the block and retires", () => {
    setGame();
    (g.Memory as Memory).unclaimTargets = { W2N1: { homeRoom: "W1N1", until: clock + 5000 } };
    const { creep, calls } = unclaimer({ owner: { username: "Foe" }, upgradeBlocked: 0 });
    runUnclaimer(creep);
    expect(calls).toEqual(["attack", "suicide"]);
    expect((g.Memory as Memory).unclaimTargets!.W2N1.blockedUntil).toBe(clock + 1000);
  });

  it("clears the target once the controller is neutral", () => {
    setGame();
    (g.Memory as Memory).unclaimTargets = { W2N1: { homeRoom: "W1N1", until: clock + 5000 } };
    const { creep, calls } = unclaimer({});
    runUnclaimer(creep);
    expect(calls).toEqual(["suicide"]);
    expect((g.Memory as Memory).unclaimTargets!.W2N1).toBeUndefined();
  });
});
