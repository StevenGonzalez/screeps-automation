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

function classifyLinks(
  room: Room,
  links: StructureLink[]
): { sources: StructureLink[]; sinks: StructureLink[] } {
  const sources: StructureLink[] = [];
  const sinks: StructureLink[] = [];

  const minerContainerIds = room.memory.minerContainerIds ?? [];
  const minerContainers = minerContainerIds
    .map((id) => Game.getObjectById(id))
    .filter(Boolean) as StructureContainer[];

  const controller = room.controller;
  const storage = room.storage;

  for (const link of links) {
    const nearMiner = minerContainers.some(
      (c) => link.pos.getRangeTo(c.pos) <= 2
    );
    const nearController =
      controller && link.pos.getRangeTo(controller.pos) <= 3;
    const nearStorage = storage && link.pos.getRangeTo(storage.pos) <= 2;

    if (nearMiner && !nearController && !nearStorage) {
      sources.push(link);
    } else if (nearController || nearStorage) {
      sinks.push(link);
    } else {
      // Unclassified: treat as source if it has energy, otherwise sink
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
  let bestFree = LINK_SINK_HEADROOM;

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
