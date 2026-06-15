/**
 * Link energy routing: each tick, drain "source" links (near energy containers)
 * into "sink" links (near the controller or storage). This eliminates the need
 * for haulers to carry energy from sources to the upgrade/storage area once
 * links are built at RCL 5+.
 *
 * Classification:
 *   source link — within 2 tiles of a miner container
 *   sink link   — within 3 tiles of the controller OR within 2 tiles of storage
 *   neutral     — transfer from any link with energy to any link that needs it
 */

const LINK_TRANSFER_THRESHOLD = 400; // only send when source has this much energy
const LINK_SINK_HEADROOM = 100;      // sink must have at least this much free capacity

export function loop() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;
    processRoomLinks(room);
  }
}

function processRoomLinks(room: Room) {
  const linkIds = room.memory.linkIds ?? [];
  if (linkIds.length < 2) return;

  const links = linkIds
    .map((id) => Game.getObjectById(id))
    .filter(Boolean) as StructureLink[];

  if (links.length < 2) return;

  const { sources, sinks } = classifyLinks(room, links);

  for (const src of sources) {
    if (src.cooldown > 0) continue;
    if (src.store[RESOURCE_ENERGY] < LINK_TRANSFER_THRESHOLD) continue;

    // Find the neediest sink
    const sink = pickSink(sinks, src);
    if (!sink) continue;

    src.transferEnergy(sink);
  }
}

// Structural role of each link — fixed by position, so it only changes when the
// link set or storage changes. Cached per room and recomputed on signature change
// instead of re-running getRangeTo for every link every tick.
type LinkRole = "source" | "sink" | "neutral";
const linkRoleCache: Record<
  string,
  { signature: string; roles: Record<string, LinkRole> }
> = {};

function getLinkRoles(
  room: Room,
  links: StructureLink[]
): Record<string, LinkRole> {
  const storage = room.storage;
  const signature = `${links.map((l) => l.id).join(",")}|${storage?.id ?? ""}`;

  const cached = linkRoleCache[room.name];
  if (cached && cached.signature === signature) return cached.roles;

  const minerContainers = (room.memory.minerContainerIds ?? [])
    .map((id) => Game.getObjectById(id))
    .filter(Boolean) as StructureContainer[];
  const controller = room.controller;

  const roles: Record<string, LinkRole> = {};
  for (const link of links) {
    const nearMiner = minerContainers.some(
      (c) => link.pos.getRangeTo(c.pos) <= 2
    );
    const nearController =
      controller && link.pos.getRangeTo(controller.pos) <= 3;
    const nearStorage = storage && link.pos.getRangeTo(storage.pos) <= 2;

    if (nearMiner && !nearController && !nearStorage) {
      roles[link.id] = "source";
    } else if (nearController || nearStorage) {
      roles[link.id] = "sink";
    } else {
      roles[link.id] = "neutral";
    }
  }

  linkRoleCache[room.name] = { signature, roles };
  return roles;
}

function classifyLinks(
  room: Room,
  links: StructureLink[]
): { sources: StructureLink[]; sinks: StructureLink[] } {
  const roles = getLinkRoles(room, links);
  const sources: StructureLink[] = [];
  const sinks: StructureLink[] = [];

  for (const link of links) {
    const role = roles[link.id];
    if (role === "source") {
      sources.push(link);
    } else if (role === "sink") {
      sinks.push(link);
    } else {
      // Unclassified: treat as source if it has energy, otherwise sink.
      // Energy is dynamic, so this branch stays per-tick (not cached).
      if (link.store[RESOURCE_ENERGY] > LINK_TRANSFER_THRESHOLD) {
        sources.push(link);
      } else {
        sinks.push(link);
      }
    }
  }

  return { sources, sinks };
}

function pickSink(
  sinks: StructureLink[],
  src: StructureLink
): StructureLink | null {
  let best: StructureLink | null = null;
  // Seed one below the headroom so a sink with *exactly* LINK_SINK_HEADROOM free still
  // qualifies (the rule is "at least HEADROOM free", and the `>` test below would
  // otherwise exclude the boundary).
  let bestFree = LINK_SINK_HEADROOM - 1;

  for (const sink of sinks) {
    if (sink.id === src.id) continue;
    if (sink.cooldown > 0) continue;
    const free = sink.store.getFreeCapacity(RESOURCE_ENERGY);
    if (free > bestFree) {
      best = sink;
      bestFree = free;
    }
  }

  return best;
}
