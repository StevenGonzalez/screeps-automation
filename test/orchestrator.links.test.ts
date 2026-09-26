import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;

g.RESOURCE_ENERGY = "energy";
g.LINK_CAPACITY = 800;
g.OK = 0;

import {
  loop as linksLoop,
  findRelayLink,
} from "../src/orchestrators/orchestrator.links";

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

/**
 * A source link by a miner container, a storage link and a controller link.
 * Each case sets how full each one is and how much energy storage holds.
 */
function makeRelayRoom(opts: {
  srcEnergy: number;
  srcCooldown?: number;
  ctrlEnergy: number;
  storageLinkEnergy: number;
  storageEnergy: number;
}) {
  const roomName = `W48S8-${clock}`;
  const links: Record<string, unknown> = {
    srcLink: makeLink("srcLink", { x: 40, y: 20 }, opts.srcEnergy, opts.srcCooldown ?? 0),
    storageLink: makeLink("storageLink", { x: 24, y: 24 }, opts.storageLinkEnergy, 0),
    ctrlLink: makeLink("ctrlLink", { x: 10, y: 7 }, opts.ctrlEnergy, 0),
  };

  const storage = {
    id: "storage1",
    pos: { x: 25, y: 25 },
    store: { [g.RESOURCE_ENERGY as string]: opts.storageEnergy },
  };
  const minerContainer = { id: "cont1", pos: { x: 41, y: 20 } };

  const room = {
    name: roomName,
    controller: { my: true, pos: { x: 9, y: 5 } },
    storage,
    memory: {
      linkIds: ["srcLink", "storageLink", "ctrlLink"],
      minerContainerIds: ["cont1"],
    } as unknown as RoomMemory,
  } as unknown as Room;

  g.Game = {
    time: clock,
    rooms: { [roomName]: room },
    getObjectById: (id: string) =>
      links[id] ?? (id === "cont1" ? minerContainer : null),
  };

  return room;
}

describe("controller link supply", () => {
  it("feeds a low controller link ahead of an emptier storage link", () => {
    makeRelayRoom({ srcEnergy: 800, ctrlEnergy: 300, storageLinkEnergy: 0, storageEnergy: 50_000 });

    linksLoop();

    expect(transfers).toEqual([{ from: "srcLink", to: "ctrlLink" }]);
  });

  it("still sends to the storage link once the controller link is stocked", () => {
    makeRelayRoom({ srcEnergy: 800, ctrlEnergy: 500, storageLinkEnergy: 0, storageEnergy: 50_000 });

    linksLoop();

    expect(transfers).toEqual([{ from: "srcLink", to: "storageLink" }]);
  });

  it("relays from the storage link when no source link can send", () => {
    makeRelayRoom({
      srcEnergy: 800,
      srcCooldown: 4,
      ctrlEnergy: 100,
      storageLinkEnergy: 800,
      storageEnergy: 50_000,
    });

    linksLoop();

    expect(transfers).toEqual([{ from: "storageLink", to: "ctrlLink" }]);
  });

  it("does not relay as well when a source link fed the controller this tick", () => {
    makeRelayRoom({ srcEnergy: 800, ctrlEnergy: 100, storageLinkEnergy: 800, storageEnergy: 50_000 });

    linksLoop();

    expect(transfers).toEqual([{ from: "srcLink", to: "ctrlLink" }]);
  });

  it("does not relay when storage is at or below the upgrader floor", () => {
    const room = makeRelayRoom({
      srcEnergy: 0,
      ctrlEnergy: 100,
      storageLinkEnergy: 800,
      storageEnergy: 10_000,
    });

    linksLoop();

    expect(transfers).toEqual([]);
    expect(findRelayLink(room)).toBeNull();
  });

  it("asks for the storage link to be filled only while the controller link is low", () => {
    const low = makeRelayRoom({ srcEnergy: 0, ctrlEnergy: 100, storageLinkEnergy: 0, storageEnergy: 50_000 });
    expect(findRelayLink(low)?.id).toBe("storageLink");

    clock += 1;
    const stocked = makeRelayRoom({ srcEnergy: 0, ctrlEnergy: 600, storageLinkEnergy: 0, storageEnergy: 50_000 });
    expect(findRelayLink(stocked)).toBeNull();
  });
});
