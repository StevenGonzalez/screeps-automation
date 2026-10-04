import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.EVENT_ATTACK = 1;
g.EVENT_OBJECT_DESTROYED = 2;
g.FIND_HOSTILE_CREEPS = 103;
g.FIND_MY_STRUCTURES = 108;
g.FIND_MY_SPAWNS = 112;
g.FIND_STRUCTURES = 107;
g.FIND_MINERALS = 116;
g.STRUCTURE_ROAD = "road";
g.STRUCTURE_CONTAINER = "container";
g.ATTACK = "attack";
g.RANGED_ATTACK = "ranged_attack";
g.WORK = "work";
g.CARRY = "carry";
g.CLAIM = "claim";
class FakeCreep {
  my = true;
  memory: CreepMemory = { role: "x" } as CreepMemory;
  constructor(public name: string, public room: { name: string }) {}
}
g.Creep = FakeCreep;

import { cryFor, cryFlight, cryHaul, heraldRival, heraldRooms, settleFlight } from "../src/services/services.herald";
import { annal, castleName, lordName, wildsName } from "../src/services/services.chronicle";
import { townAurora, townDragon } from "../src/services/services.town";
import { TOWN_DAY_LENGTH } from "../src/config/config.town";

const ROOM = "W1N1";
let tick = 100;
const NO_TRADE = { outgoingTransactions: [], incomingTransactions: [] };

function roomWith(events: unknown[], controller?: unknown, hostiles: unknown[] = []) {
  return {
    name: ROOM,
    controller,
    memory: {} as RoomMemory,
    getEventLog: () => JSON.stringify(events),
    find: () => hostiles,
  };
}

function setup(room: ReturnType<typeof roomWith>, objects: Record<string, unknown>) {
  tick++;
  g.Game = {
    time: tick,
    gcl: { level: 1 },
    market: NO_TRADE,
    rooms: { [ROOM]: room },
    getObjectById: (id: string) => objects[id] ?? null,
  };
}

function killed(victim: string, by: string[]) {
  return [
    ...by.map((id) => ({ event: 1, objectId: id, data: { targetId: victim } })),
    { event: 2, objectId: victim, data: { type: "creep" } },
  ];
}

describe("herald", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    g.Memory = {};
  });

  it("has the creep that struck a raider down shout a kill cry", () => {
    const knight = new FakeCreep("Dragon Knight Edric", { name: ROOM });
    const bystander = new FakeCreep("Mason Aldric", { name: ROOM });
    setup(roomWith(killed("raider", ["knight"])), { knight });
    heraldRooms();
    expect(cryFor(knight as unknown as Creep)).toBeTruthy();
    expect(cryFor(bystander as unknown as Creep)).toBeUndefined();
  });

  it("tells a raider struck down by one creep alone as that creep's deed", () => {
    const knight = new FakeCreep("Dragon Knight Edric", { name: ROOM });
    setup(roomWith(killed("raider", ["knight", "knight"])), { knight });
    heraldRooms();
    expect((g.Memory as Memory).chronicle!.map((l) => l.text)).toEqual([
      "A raider fell to Dragon Knight Edric in the Gallows Forest.",
    ]);

    g.Memory = {};
    const tower = { my: true };
    setup(roomWith(killed("raider", ["knight", "tower"])), { knight, tower });
    heraldRooms();
    expect((g.Memory as Memory).chronicle!.map((l) => l.text)).toEqual(["A raider fell in the Gallows Forest."]);
  });

  it("has the whole room cheer a kill made by towers alone", () => {
    const tower = { my: true };
    const mason = new FakeCreep("Mason Aldric", { name: ROOM });
    setup(roomWith(killed("raider", ["tower"])), { tower });
    heraldRooms();
    expect(cryFor(mason as unknown as Creep)).toBe("Huzzah!");
  });

  it("stays quiet when one of ours dies", () => {
    const mason = new FakeCreep("Mason Aldric", { name: ROOM });
    const raider = { my: false };
    setup(roomWith(killed("mason", ["raider"])), { raider });
    heraldRooms();
    expect(cryFor(mason as unknown as Creep)).toBeUndefined();
  });

  it("proclaims a new controller level once, not on the first look", () => {
    const mason = new FakeCreep("Mason Aldric", { name: ROOM });
    const room = roomWith([], { my: true, level: 6 });
    setup(room, {});
    heraldRooms();
    expect(cryFor(mason as unknown as Creep)).toBeUndefined();

    room.controller = { my: true, level: 7 };
    setup(room, {});
    heraldRooms();
    expect(cryFor(mason as unknown as Creep)).toBe("Long live!");

    setup(room, {});
    heraldRooms();
    expect(cryFor(mason as unknown as Creep)).toBeUndefined();

    const log = (g.Memory as Memory).chronicle!;
    expect(log).toHaveLength(1);
    expect(log[0].text).toContain("rises to level 7");
    expect((g.Memory as Memory).gossip).toEqual({ line: "level 7!", until: tick - 1 + 600 });
  });

  it("tells once per level that the throne nears its next level", () => {
    const room = roomWith([], { my: true, level: 6, progress: 80, progressTotal: 100 });
    const check = (controller: unknown) => {
      room.controller = controller;
      tick = Math.ceil((tick + 1) / 100) * 100 - 1;
      setup(room, {});
      heraldRooms();
    };
    const lines = () => ((g.Memory as Memory).chronicle ?? []).map((l) => l.text);
    check({ my: true, level: 6, progress: 80, progressTotal: 100 });
    check({ my: true, level: 6, progress: 91, progressTotal: 100 });
    check({ my: true, level: 6, progress: 95, progressTotal: 100 });
    expect(lines()).toEqual([`The enchanters of ${castleName(ROOM)} feel the throne stir. Level 7 is near.`]);

    check({ my: true, level: 7, progress: 95, progressTotal: 100 });
    check({ my: true, level: 8, progress: 0 });
    expect(lines()).toHaveLength(4);
    expect(lines()[1]).toContain("rises to level 7");
    expect(lines()[2]).toContain("Level 8 is near");
    expect(lines()[3]).toContain("rises to level 8");
  });

  it("does not tell of a throne stirring at level 1 or between checks", () => {
    const room = roomWith([], { my: true, level: 1, progress: 199, progressTotal: 200 });
    tick = Math.ceil((tick + 1) / 100) * 100 - 1;
    setup(room, {});
    heraldRooms();
    room.controller = { my: true, level: 2, progress: 44000, progressTotal: 45000 };
    setup(room, {});
    heraldRooms();
    expect(((g.Memory as Memory).chronicle ?? []).filter((l) => l.text.includes("stir"))).toEqual([]);
  });

  it("tells of a remote's waystation razed by raiders, not of one worn away", () => {
    const castle = { ...roomWith([], { my: true, level: 6 }), name: "W2N1" };
    castle.memory.remoteRooms = [{ roomName: ROOM } as RemoteRoomData];
    const look = (events: unknown[]) => {
      tick++;
      g.Game = {
        time: tick,
        gcl: { level: 1 },
        market: NO_TRADE,
        rooms: { W2N1: castle, [ROOM]: roomWith(events) },
        creeps: {},
        getObjectById: () => null,
      };
      heraldRooms();
    };
    look([
      { event: 1, objectId: "raider", data: { targetId: "box" } },
      { event: 2, objectId: "box", data: { type: "container" } },
    ]);
    look([{ event: 2, objectId: "box2", data: { type: "container" } }]);

    expect(((g.Memory as Memory).chronicle ?? []).map((l) => l.text)).toEqual([
      `Raiders razed a waystation in the ${wildsName(ROOM)}. ${castleName("W2N1")}'s gold spills into the mud.`,
    ]);
  });

  it("gathers a fight's kills into one chronicle line", () => {
    const tower = { my: true };
    setup(roomWith(killed("raider1", ["tower"])), { tower });
    heraldRooms();
    setup(roomWith(killed("raider2", ["tower"])), { tower });
    heraldRooms();

    const log = (g.Memory as Memory).chronicle!;
    expect(log).toHaveLength(1);
    expect(log[0].text).toBe("2 raiders fell in the Gallows Forest.");
    expect((g.Memory as Memory).annals?.slain).toBe(2);
    expect((g.Memory as Memory).gossip?.line).toBe("victory!");
  });

  it("mourns one of ours who fell wounded, naming the foe still in the room", () => {
    const wilds = { name: "W2N1", find: () => [{ owner: { username: "Invader" } }], getEventLog: () => "[]" };
    const merchant = { pos: { roomName: "W2N1" }, hits: 300, hitsMax: 1000, ticksToLive: 900, memory: {} };
    tick++;
    g.Game = { time: tick, gcl: { level: 1 }, market: NO_TRADE, rooms: {}, creeps: { "Merchant Leofric": merchant } };
    heraldRooms();
    tick++;
    g.Game = { time: tick, gcl: { level: 1 }, market: NO_TRADE, rooms: { W2N1: wilds }, creeps: {} };
    heraldRooms();

    expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual([
      "Merchant Leofric fell to raiders in the Shadow March.",
    ]);
    expect((g.Memory as Memory).annals?.fallen).toBe(1);
    expect((g.Memory as Memory).gossip?.line).toBe("† Leofric");
  });

  it("does not mourn a creep that died of age or unhurt", () => {
    const old = { pos: { roomName: ROOM }, hits: 300, hitsMax: 1000, ticksToLive: 1, memory: {} };
    const recycled = { pos: { roomName: ROOM }, hits: 1000, hitsMax: 1000, ticksToLive: 600, memory: {} };
    tick++;
    g.Game = { time: tick, gcl: { level: 1 }, market: NO_TRADE, rooms: {}, creeps: { "Porter Ada": old, "Reeve Bran": recycled } };
    heraldRooms();
    tick++;
    g.Game = { time: tick, gcl: { level: 1 }, market: NO_TRADE, rooms: {}, creeps: {} };
    heraldRooms();

    expect((g.Memory as Memory).chronicle).toBeUndefined();
  });

  it("keeps a tally of the foes each creep strikes down", () => {
    const knight = new FakeCreep("Dragon Knight Edric", { name: ROOM });
    const raid = [...killed("raider1", ["knight"]), ...killed("raider2", ["knight", "knight"])];
    setup(roomWith(raid), { knight });
    heraldRooms();
    expect(knight.memory.kills).toBe(2);
  });

  it("names a fallen veteran's tally", () => {
    const veteran = { pos: { roomName: "W2N1" }, hits: 300, hitsMax: 1000, ticksToLive: 900, memory: { kills: 3 } };
    tick++;
    g.Game = { time: tick, gcl: { level: 1 }, market: NO_TRADE, rooms: {}, creeps: { "Dragon Knight Edric": veteran } };
    heraldRooms();
    tick++;
    g.Game = { time: tick, gcl: { level: 1 }, market: NO_TRADE, rooms: {}, creeps: {} };
    heraldRooms();

    expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual([
      "Dragon Knight Edric, who slew 3 foes, fell in the Shadow March.",
      "The minstrels make a song of Dragon Knight Edric, who slew more foes than any before.",
    ]);
  });

  it("lays a veteran who outlived the fighting to rest", () => {
    const veteran = { pos: { roomName: ROOM }, hits: 1000, hitsMax: 1000, ticksToLive: 1, memory: { kills: 1 } };
    tick++;
    g.Game = { time: tick, gcl: { level: 1 }, market: NO_TRADE, rooms: {}, creeps: { "Dragon Knight Edric": veteran } };
    heraldRooms();
    tick++;
    g.Game = { time: tick, gcl: { level: 1 }, market: NO_TRADE, rooms: {}, creeps: {} };
    heraldRooms();

    expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual([
      "Dragon Knight Edric, who slew a foe, was laid to rest with honours.",
      "The minstrels make a song of Dragon Knight Edric, who slew more foes than any before.",
    ]);
    expect((g.Memory as Memory).annals?.fallen).toBeUndefined();
  });

  it("makes a song of each veteran who dies having slain more than any before", () => {
    const life = (name: string, kills: number, hits: number) => {
      const veteran = { pos: { roomName: ROOM }, hits, hitsMax: 1000, ticksToLive: hits < 1000 ? 900 : 1, memory: { kills } };
      tick++;
      g.Game = { time: tick, gcl: { level: 1 }, market: NO_TRADE, rooms: {}, creeps: { [name]: veteran } };
      heraldRooms();
      tick++;
      g.Game = { time: tick, gcl: { level: 1 }, market: NO_TRADE, rooms: {}, creeps: {} };
      heraldRooms();
    };
    life("Dragon Knight Edric", 2, 1000);
    life("Dragon Knight Bran", 1, 1000);
    life("Dragon Knight Ada", 3, 300);

    const songs = (g.Memory as Memory).chronicle?.map((l) => l.text).filter((t) => t.includes("song"));
    expect(songs).toEqual([
      "The minstrels make a song of Dragon Knight Edric, who slew more foes than any before.",
      "The minstrels make a song of Dragon Knight Ada, who slew more foes than any before.",
    ]);
    expect((g.Memory as Memory).greatestSlayer).toEqual({ name: "Dragon Knight Ada", kills: 3 });
  });

  it("tells once of a vendors' road that is paved", () => {
    const home = roomWith([], { my: true, level: 4 });
    home.memory.remoteRooms = [
      { roomName: "W2N1", sources: [{ sourceId: "s", containerId: "c", roadTiles: "5,5;6,6" }] },
    ] as unknown as RemoteRoomData[];
    const roads = [{ structureType: "road", pos: { x: 5, y: 5 } }];
    const wilds = { name: "W2N1", find: (type: number) => (type === g.FIND_STRUCTURES ? roads : []), getEventLog: () => "[]" };
    const at = (time: number) => {
      g.Game = { time, gcl: { level: 1 }, market: NO_TRADE, rooms: { [ROOM]: home, W2N1: wilds }, getObjectById: () => null };
      heraldRooms();
    };
    at(1000);
    roads.push({ structureType: "road", pos: { x: 6, y: 6 } });
    at(1050);
    at(1100);
    at(1200);

    const told = (g.Memory as Memory).chronicle?.map((l) => l.text).filter((t) => t.includes("road"));
    expect(told).toEqual([
      `The road from ${castleName(ROOM)} to the ${wildsName("W2N1")} is paved. Its merchants travel light.`,
    ]);
    expect((g.Memory as Memory).gossip?.line).toBe("new road!");
  });

  it("chronicles a merchant who retires with the richest haul yet", () => {
    const life = (name: string, hauled: number) => {
      const merchant = { pos: { roomName: ROOM }, hits: 1000, hitsMax: 1000, ticksToLive: 1, memory: { hauled } };
      tick++;
      g.Game = { time: tick, gcl: { level: 1 }, market: NO_TRADE, rooms: {}, creeps: { [name]: merchant } };
      heraldRooms();
      tick++;
      g.Game = { time: tick, gcl: { level: 1 }, market: NO_TRADE, rooms: {}, creeps: {} };
      heraldRooms();
    };
    life("Merchant Leofric", 31200);
    life("Merchant Bran", 20000);
    life("Merchant Ada", 40500);

    expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual([
      "Merchant Leofric retired from the road with 31.2K gold brought home, the most of any merchant yet.",
      "Merchant Ada retired from the road with 40.5K gold brought home, the most of any merchant yet.",
    ]);
    expect((g.Memory as Memory).richestHauler).toBe("Merchant Ada");
  });

  it("adds each load a merchant brings home to its lifetime haul", () => {
    const merchant = new FakeCreep("Merchant Leofric", { name: ROOM });
    setup(roomWith([]), {});
    cryHaul(merchant as unknown as Creep, 1200);
    cryHaul(merchant as unknown as Creep, 800);
    expect(merchant.memory.hauled).toBe(2000);
  });

  it("proclaims a new GCL once, not on the first look", () => {
    setup(roomWith([]), {});
    heraldRooms();
    (g.Game as { gcl: { level: number } }).gcl.level = 2;
    heraldRooms();
    heraldRooms();

    expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual([
      "The Crown's renown grows. The realm may now hold 2 castles.",
    ]);
  });

  it("writes one line a visit for a player's spies, and another when they come armed", () => {
    const castle = { my: true, level: 6 };
    const spy = { owner: { username: "Rival" }, body: [{ type: "move" }] };
    const raider = { owner: { username: "Rival" }, body: [{ type: "attack" }, { type: "move" }] };
    setup(roomWith([], castle, [spy]), {});
    heraldRooms();
    setup(roomWith([], castle, [spy]), {});
    heraldRooms();
    setup(roomWith([], castle, [spy, raider]), {});
    heraldRooms();

    const lines = (g.Memory as Memory).chronicle?.map((l) => l.text) ?? [];
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Spies of Rival the Fair crept about /);
    expect(lines[1]).toMatch(/^A war party of Rival the Fair came in arms to the walls of /);
  });

  describe("wayfarers in a remote", () => {
    const REMOTE = "W2N1";

    function remoteWith(hostiles: unknown[], entry: Partial<RemoteRoomData> = {}) {
      const castle = roomWith([], { my: true, level: 6 });
      castle.memory.remoteRooms = [{ roomName: REMOTE, sources: [], lastSeen: 0, hostile: false, ...entry }];
      setup(castle, {});
      (g.Game as { rooms: Record<string, unknown> }).rooms[REMOTE] = { name: REMOTE, find: () => hostiles, getEventLog: () => "[]" };
      heraldRooms();
    }

    const creep = (who: string, ...parts: string[]) => ({ owner: { username: who }, body: parts.map((type) => ({ type, hits: 100 })) });

    it("writes one line a visit for another player's labourers", () => {
      const diggers = [creep("Rival", "work", "carry", "move"), creep("Rival", "carry", "move")];
      remoteWith(diggers);
      remoteWith(diggers);
      expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual([
        `Labourers of Rival the Fair passed through the ${wildsName(REMOTE)}.`,
      ]);
    });

    it("names a lone creep by what it came as", () => {
      remoteWith([creep("Rival", "claim", "move")]);
      remoteWith([creep("Other", "move")]);
      const lines = (g.Memory as Memory).chronicle?.map((l) => l.text) ?? [];
      expect(lines[0]).toMatch(/^An envoy of Rival the Fair passed through /);
      expect(lines[1]).toMatch(/^A scout of Other the \w+ passed through /);
    });

    it("leaves armed men and the rival holding the remote to the line that tells of the hold", () => {
      remoteWith([creep("Rival", "attack", "move"), creep("Rival", "work", "move")]);
      remoteWith([creep("Rival", "work", "move")], { hostile: true, rival: "Rival" });
      expect((g.Memory as Memory).chronicle ?? []).toEqual([]);
    });
  });

  it("calls the castle to arms once, when a war party is first seen", () => {
    const castle = { my: true, level: 6 };
    const spy = { owner: { username: "Rival" }, body: [{ type: "move" }] };
    const raider = { owner: { username: "Rival" }, body: [{ type: "attack" }, { type: "move" }] };
    const mason = new FakeCreep("Mason Aldric", { name: ROOM }) as unknown as Creep;
    setup(roomWith([], castle, [spy]), {});
    heraldRooms();
    expect(cryFor(mason)).toBeUndefined();
    setup(roomWith([], castle, [spy, raider]), {});
    heraldRooms();
    expect(cryFor(mason)).toBe("To arms!");
    setup(roomWith([], castle, [spy, raider]), {});
    heraldRooms();
    expect(cryFor(mason)).toBeUndefined();
    expect((g.Memory as Memory).gossip?.line).toBe("raiders!");
  });

  it("writes the realm's trades with other players, one line a partner and ware", () => {
    const deal = (time: number, amount: number, who: string | undefined, resourceType = "O") => ({
      time,
      resourceType,
      amount,
      from: ROOM,
      to: "E1S1",
      sender: { username: "Me" },
      recipient: who ? { username: who } : undefined,
      order: { id: "o", type: "sell", price: 80 },
    });
    const market = { outgoingTransactions: [] as unknown[], incomingTransactions: [] as unknown[] };
    const at = (time: number) => {
      g.Game = { time, gcl: { level: 1 }, market, rooms: {}, creeps: {} };
      heraldRooms();
    };
    g.Memory = { rooms: { [ROOM]: { townName: "Ravenhold" } } };
    // Trades from before the first look are old news.
    market.outgoingTransactions = [deal(90, 5, "Jumpp")];
    at(100);
    market.outgoingTransactions = [
      deal(110, 1000, "Jumpp"),
      deal(105, 294, "Jumpp"),
      // Moved between our own castles: not a trade.
      { ...deal(104, 50, "Me"), order: undefined },
      deal(103, 7, undefined, "energy"),
    ];
    market.incomingTransactions = [
      { time: 120, resourceType: "H", amount: 4500, from: "W9N9", to: ROOM, sender: { username: "Oleksii" }, order: {} },
    ];
    at(125);
    // Already told, and a deal made this very tick waits for the next look.
    market.outgoingTransactions = [deal(150, 6, "Jumpp"), ...market.outgoingTransactions];
    at(150);

    expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual([
      "Ravenhold sold 1294 oxygen to the merchants of Jumpp the Elder.",
      "Ravenhold sold 7 gold to the free markets.",
      "Ravenhold bought 4500 hydrogen from the merchants of Oleksii the Grey.",
    ]);
    at(175);
    expect((g.Memory as Memory).chronicle?.[0].text).toBe("Ravenhold sold 1300 oxygen to the merchants of Jumpp the Elder.");
  });

  it("tells of the masons' new works once they stand, and not what stood at the first look", () => {
    g.Memory = { rooms: { [ROOM]: { townName: "Ravenhold" } } };
    let built = ["spawn", "tower", "extension"];
    const room = {
      name: ROOM,
      controller: { my: true, level: 7 },
      memory: {} as RoomMemory,
      getEventLog: () => "[]",
      find: (type: number) => (type === 108 ? built.map((structureType) => ({ structureType })) : []),
    };
    const at = (time: number) => {
      g.Game = { time, gcl: { level: 1 }, market: NO_TRADE, rooms: { [ROOM]: room }, creeps: {} };
      heraldRooms();
    };
    at(1000);
    built = [...built, "tower", "lab", "lab", "extension", "spawn"];
    at(1100);
    built = [...built, "lab"];
    at(1200);

    expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual([
      "The masons of Ravenhold raise a barracks.",
      "The masons of Ravenhold raise a watchtower.",
      "The masons of Ravenhold raise 3 alchemy labs.",
    ]);
  });

  it("gives the pilgrims the credit for the works of a keep they are still founding", () => {
    g.Memory = {
      rooms: { [ROOM]: { townName: "Ravenhold" } },
      expansion: { roomName: ROOM, homeRoom: "W2N2", phase: "bootstrapping", startedAt: 0 },
    };
    let built: string[] = [];
    const room = {
      name: ROOM,
      controller: { my: true, level: 1 },
      memory: {} as RoomMemory,
      getEventLog: () => "[]",
      find: (type: number) => (type === 108 ? built.map((structureType) => ({ structureType })) : []),
    };
    const at = (time: number) => {
      g.Game = { time, gcl: { level: 1 }, market: NO_TRADE, rooms: { [ROOM]: room }, creeps: {} };
      heraldRooms();
    };
    at(1000);
    built = ["spawn"];
    at(1100);

    expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual(["The pilgrims of Ravenhold raise a barracks."]);
  });

  it("tells when a castle's vein is dug dry and when it runs full again, not what it was at the first look", () => {
    g.Memory = { rooms: { [ROOM]: { townName: "Ravenhold" } } };
    const mineral = { mineralType: "O", mineralAmount: 0, ticksToRegeneration: 49_800 as number | undefined };
    const room = {
      name: ROOM,
      controller: { my: true, level: 6 },
      memory: {} as RoomMemory,
      getEventLog: () => "[]",
      find: (type: number) => (type === g.FIND_MINERALS ? [mineral] : []),
    };
    const at = (time: number) => {
      g.Game = { time, gcl: { level: 1 }, market: NO_TRADE, rooms: { [ROOM]: room }, creeps: {} };
      heraldRooms();
    };
    at(1000);
    Object.assign(mineral, { mineralAmount: 70_000, ticksToRegeneration: undefined });
    at(1100);
    at(1200);
    Object.assign(mineral, { mineralAmount: 0, ticksToRegeneration: 50_000 });
    at(1300);
    at(1400);

    expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual([
      "The oxygen vein beneath Ravenhold runs full again. Its jewelers take up their picks.",
      "The oxygen vein beneath Ravenhold is dug dry. Its jewelers lay down their picks for 50 days.",
    ]);
  });

  it("tells of each new season once, not on the first look", () => {
    const at = (time: number) => {
      g.Game = { time, gcl: { level: 1 }, market: NO_TRADE, rooms: {}, creeps: {} };
      heraldRooms();
    };
    at(6_998);
    at(6_999);
    at(7_000);
    at(7_001);

    expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual([
      "Summer comes to the realm. The days run long on the vendors' roads. The Midsummer Fair begins.",
    ]);
  });

  it("reads out the season's annals as the season turns", () => {
    const at = (time: number) => {
      g.Game = { time, gcl: { level: 1 }, market: NO_TRADE, rooms: {}, creeps: {} };
      heraldRooms();
    };
    at(0);
    annal("gold", 152_300);
    annal("slain", 7);
    annal("fallen", 1);
    annal("recruits", 45);
    at(6_999);
    at(7_000);

    expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual([
      "So ends the spring. This season the realm gathered 152.3K gold, raised 45 recruits, slew 7 foes and buried 1 of its own.",
      "Summer comes to the realm. The days run long on the vendors' roads. The Midsummer Fair begins.",
    ]);
    expect((g.Memory as Memory).annals).toEqual({ since: 7_000, gold: 0, slain: 0, fallen: 0, recruits: 0 });
  });

  it("ends the year with the winter, names the new one in spring and counts the realm's souls", () => {
    const castle = roomWith([], { my: true, level: 6 });
    const creeps = { A: { spawning: true }, B: { spawning: true } };
    const at = (time: number) => {
      g.Game = { time, gcl: { level: 1 }, market: NO_TRADE, rooms: { [ROOM]: castle }, creeps };
      heraldRooms();
    };
    at(27_000);
    annal("gold", 900);
    at(28_000);

    expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual([
      "So ends the winter, and with it the year 1. Since the scribes took up their pens the realm gathered 900 gold, slew no foe and lost none of its own.",
      "Spring comes to the realm. The snow melts from the castle walls. It is the year 2 of the Old Reckoning. The Sowing Feast begins.",
      "The scribes count 2 souls in the realm and its one castle.",
    ]);
  });

  it("leaves recruits out of annals begun before they were counted", () => {
    g.Game = { time: 3_000 };
    g.Memory = { annals: { since: 0, gold: 0, slain: 0, fallen: 0 } };
    annal("recruits", 1);
    expect((g.Memory as Memory).annals?.recruits).toBeUndefined();
  });

  it("owns up to annals begun partway through a season", () => {
    const at = (time: number) => {
      g.Game = { time, gcl: { level: 1 }, market: NO_TRADE, rooms: {}, creeps: {} };
      heraldRooms();
    };
    at(3_000);
    annal("gold", 900);
    at(7_000);

    expect((g.Memory as Memory).chronicle?.[0].text).toBe(
      "So ends the spring. Since the scribes took up their pens the realm gathered 900 gold, slew no foe and lost none of its own."
    );
  });

  it("has the castle cry out at a passing dragon, and the chronicle tell of it once", () => {
    let start = 0;
    while (townDragon(start)?.t !== 0) start++;
    const mason = new FakeCreep("Mason Aldric", { name: ROOM });
    const room = roomWith([], { my: true, level: 6 });
    const at = (time: number) => {
      g.Game = { time, gcl: { level: 1 }, market: NO_TRADE, rooms: { [ROOM]: room }, creeps: {}, getObjectById: () => null };
      heraldRooms();
      return cryFor(mason as unknown as Creep);
    };
    expect(at(start - 1)).toBeUndefined();
    expect(at(start)).toBe("Dragon!");
    expect(at(start + 1)).toBeUndefined();
    expect(at(start + 8)).toBe("Look up!");

    const lines = ((g.Memory as Memory).chronicle ?? []).map((l) => l.text).filter((t) => t.includes("dragon"));
    expect(lines).toHaveLength(1);
  });

  it("has the castle start at each wolf's howl on a full-moon night, and chronicles the first", () => {
    // Night falls at 700; day 4 of every eight has the full moon.
    const night = 4 * TOWN_DAY_LENGTH + 700;
    const mason = new FakeCreep("Mason Aldric", { name: ROOM });
    const room = roomWith([], { my: true, level: 6 });
    const at = (time: number) => {
      g.Game = { time, gcl: { level: 1 }, market: NO_TRADE, rooms: { [ROOM]: room }, creeps: {}, getObjectById: () => null };
      heraldRooms();
      return cryFor(mason as unknown as Creep);
    };
    expect(at(night)).toBe("Wolves!");
    expect(at(night + 1)).toBeUndefined();
    expect(at(night + 50)).toBe("Hark!");

    const lines = ((g.Memory as Memory).chronicle ?? []).map((l) => l.text).filter((t) => t.includes("Wolves"));
    expect(lines).toEqual([`Wolves howled beneath the full moon outside the walls of ${castleName(ROOM)}.`]);
  });

  it("tells of the wolves once for the whole realm, naming every castle", () => {
    const night = 12 * TOWN_DAY_LENGTH + 700;
    const other = { ...roomWith([], { my: true, level: 3 }), name: "W2N1" };
    const scout = new FakeCreep("Raven Ysolde", { name: "W2N1" });
    g.Game = {
      time: night,
      gcl: { level: 2 },
      market: NO_TRADE,
      rooms: { [ROOM]: roomWith([], { my: true, level: 6 }), W2N1: other },
      creeps: {},
      getObjectById: () => null,
    };
    heraldRooms();
    expect(cryFor(scout as unknown as Creep)).toBe("Wolves!");

    const lines = ((g.Memory as Memory).chronicle ?? []).map((l) => l.text).filter((t) => t.includes("Wolves"));
    expect(lines).toEqual([
      `Wolves howled beneath the full moon outside the walls of ${castleName(ROOM)} and ${castleName("W2N1")}.`,
    ]);
  });

  it("tells of other lords' keeps raised, grown, taken and abandoned, but not of the first look", () => {
    g.Game = { time: 500 };
    const seen = (owner: string | undefined, rcl: number) => ({ owner, rcl }) as RoomIntelData;
    const wilds = `the ${wildsName("W5N5")}`;
    heraldRival("W5N5", undefined, "Jumpp", 3);
    heraldRival("W5N5", seen(undefined, 0), "Jumpp", 1);
    heraldRival("W5N5", seen("Jumpp", 1), "Jumpp", 2);
    heraldRival("W5N5", seen("Jumpp", 2), "Jumpp", 2);
    heraldRival("W5N5", seen("Jumpp", 2), "Tigga", 1);
    heraldRival("W5N5", seen("Tigga", 1), undefined, 0);
    expect(((g.Memory as Memory).chronicle ?? []).map((l) => l.text)).toEqual([
      `${lordName("Jumpp")} raises a keep in ${wilds}.`,
      `The keep of ${lordName("Jumpp")} in ${wilds} rises to level 2.`,
      `${lordName("Tigga")} seizes ${wilds} from ${lordName("Jumpp")}.`,
      `The keep of ${lordName("Tigga")} in ${wilds} lies abandoned.`,
    ]);
  });

  it("rings the bells once for the first creep a new keep raises itself", () => {
    const spawn: { spawning: { name: string } | null } = { spawning: null };
    const room = {
      ...roomWith([], { my: true, level: 1 }),
      find: (type: number) => (type === g.FIND_MY_SPAWNS ? [spawn] : []),
    };
    // Marked spawning so the fallen roll call leaves them be.
    const pilgrim = Object.assign(new FakeCreep("Pilgrim Osric", { name: ROOM }), {
      spawning: true,
      memory: { role: "pilgrim", homeRoom: "W2N1" } as CreepMemory,
    });
    const born = Object.assign(new FakeCreep("Villager Aldric", { name: ROOM }), {
      spawning: true,
      memory: { role: "villager", homeRoom: ROOM } as CreepMemory,
    });
    (g.Memory as Memory).expansion = { roomName: ROOM, homeRoom: "W2N1", phase: "bootstrapping" } as Memory["expansion"];
    const run = (time: number) => {
      g.Game = {
        time,
        gcl: { level: 1 },
        market: NO_TRADE,
        rooms: { [ROOM]: room },
        creeps: spawn.spawning ? { [pilgrim.name]: pilgrim, [born.name]: born } : { [pilgrim.name]: pilgrim },
        getObjectById: () => null,
      };
      heraldRooms();
    };
    run(900);
    spawn.spawning = { name: born.name };
    run(901);
    expect(cryFor(pilgrim as unknown as Creep)).toBe("Huzzah!");
    run(902);

    const lines = ((g.Memory as Memory).chronicle ?? []).map((l) => l.text).filter((t) => t.includes("bells"));
    expect(lines).toEqual([`The bells of ${castleName(ROOM)} ring for the first born in its own barracks: Villager Aldric.`]);
    expect(room.memory.firstBorn).toBe("Villager Aldric");
  });

  it("rings the bells again when a keep's first born dies of old age", () => {
    (g.Memory as Memory).rooms = { [ROOM]: { firstBorn: "Villager Aldric" } } as Memory["rooms"];
    const elder = { pos: { roomName: ROOM }, hits: 1000, hitsMax: 1000, ticksToLive: 1, memory: {} };
    tick++;
    g.Game = { time: tick, gcl: { level: 1 }, market: NO_TRADE, rooms: {}, creeps: { "Villager Aldric": elder } };
    heraldRooms();
    tick++;
    g.Game = { time: tick, gcl: { level: 1 }, market: NO_TRADE, rooms: {}, creeps: {} };
    heraldRooms();

    expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual([
      `Villager Aldric, the first born in the barracks of ${castleName(ROOM)}, has died of old age. The keep's bells ring once more.`,
    ]);
    expect((g.Memory as Memory).rooms[ROOM].firstBorn).toBeUndefined();
    expect((g.Memory as Memory).gossip?.line).toBe("† Aldric");
  });

  it("passes quietly over a new keep that already has creeps of its own", () => {
    const room = {
      ...roomWith([], { my: true, level: 2 }),
      find: (type: number) => (type === g.FIND_MY_SPAWNS ? [{ spawning: { name: "Porter Bran" } }] : []),
    };
    const elder = Object.assign(new FakeCreep("Villager Aldric", { name: ROOM }), {
      spawning: true,
      memory: { role: "villager", homeRoom: ROOM } as CreepMemory,
    });
    (g.Memory as Memory).expansion = { roomName: ROOM, homeRoom: "W2N1", phase: "bootstrapping" } as Memory["expansion"];
    g.Game = { time: 950, gcl: { level: 1 }, market: NO_TRADE, rooms: { [ROOM]: room }, creeps: { [elder.name]: elder }, getObjectById: () => null };
    heraldRooms();
    expect(((g.Memory as Memory).chronicle ?? []).filter((l) => l.text.includes("bells"))).toEqual([]);
    expect(room.memory.heraldBorn).toBe(true);
  });

  it("tells of the wisps once, as a new-moon night falls, and has every castle mutter", () => {
    const room = roomWith([], { my: true, level: 4 });
    const mason = new FakeCreep("Mason Aldric", { name: ROOM });
    for (const time of [8 * TOWN_DAY_LENGTH + 699, 8 * TOWN_DAY_LENGTH + 700, 8 * TOWN_DAY_LENGTH + 701, 9 * TOWN_DAY_LENGTH + 700]) {
      g.Game = { time, gcl: { level: 1 }, market: NO_TRADE, rooms: { [ROOM]: room }, creeps: {}, getObjectById: () => null };
      heraldRooms();
      if (time === 8 * TOWN_DAY_LENGTH + 700) expect(cryFor(mason as unknown as Creep)).toBe("Wisps!");
    }
    const lines = ((g.Memory as Memory).chronicle ?? []).map((l) => l.text).filter((t) => /wisp|lights|marsh/i.test(t));
    expect(lines).toHaveLength(1);
  });

  it("has every castle's wisp cry fit in what creep.say shows", () => {
    const names = ["W1N1", "W2N1", "W3N1"];
    const rooms = Object.fromEntries(names.map((name) => [name, { ...roomWith([], { my: true, level: 4 }), name }]));
    g.Game = { time: 8 * TOWN_DAY_LENGTH + 700, gcl: { level: 1 }, market: NO_TRADE, rooms, creeps: {}, getObjectById: () => null };
    heraldRooms();
    for (const name of names) {
      const cry = cryFor(new FakeCreep("Mason Aldric", { name }) as unknown as Creep);
      expect(cry).toBeTruthy();
      expect(cry!.length, cry).toBeLessThanOrEqual(10);
    }
  });

  it("chronicles the northern lights once, as night falls", () => {
    let day = 0;
    while (!townAurora(day * TOWN_DAY_LENGTH + 800)) day++;
    const night = day * TOWN_DAY_LENGTH + 700;
    const room = roomWith([], { my: true, level: 6 });
    for (const time of [night - 1, night, night + 1, night + 200]) {
      g.Game = { time, gcl: { level: 1 }, market: NO_TRADE, rooms: { [ROOM]: room }, creeps: {}, getObjectById: () => null };
      heraldRooms();
    }
    const lines = ((g.Memory as Memory).chronicle ?? []).map((l) => l.text).filter((t) => /light|Ribbons/.test(t));
    expect(lines).toHaveLength(1);
  });

  it("has a fleeing vendor cry out once, and again only after it settles", () => {
    const peddler = new FakeCreep("Peddler Osric", { name: "W1N2" });
    setup(roomWith([]), {});
    heraldRooms();
    cryFlight(peddler as unknown as Creep);
    expect(cryFor(peddler as unknown as Creep)).toBe("Bandits!");

    setup(roomWith([]), {});
    heraldRooms();
    cryFlight(peddler as unknown as Creep);
    expect(cryFor(peddler as unknown as Creep)).toBeUndefined();

    settleFlight(peddler as unknown as Creep);
    cryFlight(peddler as unknown as Creep);
    expect(cryFor(peddler as unknown as Creep)).toBe("Bandits!");
  });
});
