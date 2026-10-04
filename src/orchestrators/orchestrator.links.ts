import { upgradingFunded } from "../services/services.treasury";

const LINK_TRANSFER_THRESHOLD = 400;
const LINK_MIN_TRANSFER = 150;
const LINK_SINK_HEADROOM = 100;
// Below this the controller link is fed ahead of every other sink, and the
// storage link relays to it when no source link does. Half a link covers an
// RCL8 upgrader (15/tick) across any realistic link cooldown.
const CONTROLLER_LINK_LOW = 400;

export function loop() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;
    processRoomLinks(room);
  }
}

function processRoomLinks(room: Room) {
  const links = getRoomLinks(room);
  if (links.length < 2) return;

  // Below the upgrader's storage floor the controller link gets nothing, or
  // the source links carry the room's whole income past storage to the
  // controller.
  const funded = upgradingFunded(room);
  const roles = getLinkRoles(room, links);
  const { sources, sinks: allSinks } = classifyLinks(room, links);
  const sinks = funded ? allSinks : allSinks.filter((l) => roles[l.id] !== "controller");
  let hungry = funded ? findHungryControllerLink(room, links) : null;

  for (const src of sources) {
    if (src.cooldown > 0) continue;

    const available = src.store[RESOURCE_ENERGY];
    if (available < LINK_MIN_TRANSFER) continue;

    const sink = hungry ?? pickSink(sinks, src);
    if (!sink) continue;

    const deficit = sink.store.getFreeCapacity(RESOURCE_ENERGY);
    if (Math.min(available, deficit) < LINK_MIN_TRANSFER) continue;

    if (src.transferEnergy(sink) === OK && sink === hungry) hungry = null;
  }

  // No source link fed the controller this tick, so pass stored energy through
  // the storage link. The filler tops the storage link up from storage while
  // findRelayLink says the relay is wanted.
  if (!hungry) return;
  const relay = findRelayLink(room);
  if (
    relay &&
    relay.cooldown === 0 &&
    relay.store[RESOURCE_ENERGY] >= LINK_MIN_TRANSFER
  ) {
    relay.transferEnergy(hungry);
  }
}

function getRoomLinks(room: Room): StructureLink[] {
  return (room.memory.linkIds ?? [])
    .map((id) => Game.getObjectById(id))
    .filter(Boolean) as StructureLink[];
}

function findHungryControllerLink(
  room: Room,
  links: StructureLink[]
): StructureLink | null {
  const roles = getLinkRoles(room, links);
  let best: StructureLink | null = null;
  for (const link of links) {
    if (roles[link.id] !== "controller") continue;
    if (link.store[RESOURCE_ENERGY] >= CONTROLLER_LINK_LOW) continue;
    if (!best || link.store[RESOURCE_ENERGY] < best.store[RESOURCE_ENERGY]) {
      best = link;
    }
  }
  return best;
}

/**
 * The storage link, when it should be relaying stored energy to a controller
 * link that has run low. Uses the upgrader's own storage floor: the relay is
 * upgrader energy by another route, so it stops where they would.
 */
export function findRelayLink(room: Room): StructureLink | null {
  if (!room.storage || !upgradingFunded(room)) return null;
  const links = getRoomLinks(room);
  if (links.length < 2) return null;
  if (!findHungryControllerLink(room, links)) return null;
  const roles = getLinkRoles(room, links);
  return links.find((l) => roles[l.id] === "storage") ?? null;
}

/**
 * Whether a miner should empty into its source link. A source link can only
 * send to the controller link or the storage link. With no storage link, and
 * the controller link shut off below the storage floor, the energy has nowhere
 * useful to go, so the miner leaves it in its container for the haulers to
 * carry to storage.
 */
export function sourceLinksHaveOutlet(room: Room): boolean {
  if (upgradingFunded(room)) return true;
  const links = getRoomLinks(room);
  const roles = getLinkRoles(room, links);
  return links.some((l) => roles[l.id] === "storage");
}

type LinkRole = "source" | "controller" | "storage" | "neutral";
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
    } else if (nearController) {
      roles[link.id] = "controller";
    } else if (nearStorage) {
      roles[link.id] = "storage";
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
    } else if (role === "controller" || role === "storage") {
      sinks.push(link);
    } else {
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
  let bestFree = LINK_SINK_HEADROOM - 1;

  // Only the sending link's cooldown gates transferEnergy, so a sink is a valid
  // target whatever its own cooldown says. Filtering on it here rejected most
  // sinks most of the time, because a sink that has ever sent is on cooldown for
  // the next several ticks.
  for (const sink of sinks) {
    if (sink.id === src.id) continue;
    const free = sink.store.getFreeCapacity(RESOURCE_ENERGY);
    if (free > bestFree) {
      best = sink;
      bestFree = free;
    }
  }

  return best;
}
