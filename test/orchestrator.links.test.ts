import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;

g.RESOURCE_ENERGY = "energy";
g.LINK_CAPACITY = 800;

import { loop as linksLoop } from "../src/orchestrators/orchestrator.links";

type Transfer = { from: string; to: string };

let clock = 200;
let transfers: Transfer[] = [];

function makeLink(
  id: string,
  pos: { x: number; y: number },
  energy: number,
  cooldown: number
) {
  return {
    id,
    cooldown,
    pos: {
      ...pos,
      getRangeTo: (other: { x: number; y: number }) =>
        Math.max(Math.abs(pos.x - other.x), Math.abs(pos.y - other.y)),
    },
    store: {
      [g.RESOURCE_ENERGY as string]: energy,
      getFreeCapacity: () => 800 - energy,
    },
    transferEnergy(target: { id: string }) {
      transfers.push({ from: id, to: target.id });
      return 0;
    },
  };
}

/**
 * One link beside a miner container and one beside storage: the source link is
 * full and off cooldown, the storage-side sink has just sent to somewhere else
 * and is still cooling down.
 */
function makeRoom(sinkCooldown: number) {
  const roomName = `W48S8-${clock}`;
  const source = makeLink("srcLink", { x: 40, y: 20 }, 800, 0);
  const sink = makeLink("sinkLink", { x: 24, y: 24 }, 0, sinkCooldown);

  const storage = { id: "storage1", pos: { x: 25, y: 25 } };
  const minerContainer = { id: "cont1", pos: { x: 41, y: 20 } };

  const room = {
    name: roomName,
    controller: { my: true, pos: { x: 9, y: 5 } },
    storage,
    memory: {
      linkIds: ["srcLink", "sinkLink"],
      minerContainerIds: ["cont1"],
    } as unknown as RoomMemory,
  } as unknown as Room;

  g.Game = {
    time: clock,
    rooms: { [roomName]: room },
    getObjectById: (id: string) => {
      if (id === "srcLink") return source;
      if (id === "sinkLink") return sink;
      if (id === "cont1") return minerContainer;
      return null;
    },
  };

  return room;
}

beforeEach(() => {
  clock += 1;
  transfers = [];
});

describe("link transfers", () => {
  it("sends from a full source link to an empty sink", () => {
    makeRoom(0);

    linksLoop();

    expect(transfers).toEqual([{ from: "srcLink", to: "sinkLink" }]);
  });

  it("still sends when the receiving link is on cooldown", () => {
    // Only the sending link's cooldown gates transferEnergy. A sink that has
    // itself sent recently is still a valid target, and skipping it stalled
    // most transfers.
    makeRoom(6);

    linksLoop();

    expect(transfers).toEqual([{ from: "srcLink", to: "sinkLink" }]);
  });
});
