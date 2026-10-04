import { getThreatInfo, isInvaderCreep, isPlayerCreep, findInvaderCore } from "../services/services.combat";
import {
  isAssignedRemoteContested,
  flagRemoteInvader,
  flagRemotePlayer,
  flagRemoteDamage,
  clearRemoteInvader,
} from "../services/services.creep";
import { cryFlight, settleFlight } from "../services/services.herald";

const REMOTE_DAMAGE_BACKOFF = 300;

export function runRemoteMiner(creep: Creep) {
  const { targetRoom, homeRoom, remoteSourceId } = creep.memory;

  if (!targetRoom || !homeRoom || !remoteSourceId) {
    creep.suicide();
    return;
  }

  const tookDamage = creep.memory._hp !== undefined && creep.hits < creep.memory._hp;
  creep.memory._hp = creep.hits;
  if (tookDamage && creep.room.name !== homeRoom) {
    creep.memory.remoteBackoffUntil = Game.time + REMOTE_DAMAGE_BACKOFF;
    // Damage taken passing through another room says nothing about the remote.
    if (creep.room.name === targetRoom) flagRemoteDamage(creep);
  }
  if (creep.memory.remoteBackoffUntil && creep.memory.remoteBackoffUntil > Game.time) {
    if (creep.room.name !== homeRoom) moveToRoom(creep, homeRoom);
    return;
  }

  const inTarget = creep.room.name === targetRoom;
  const threat = inTarget ? getThreatInfo(creep.room) : null;
  const core = inTarget ? findInvaderCore(creep.room) : null;
  if (core) flagRemoteInvader(creep);
  else if (threat && threat.score > 0) {
    if (threat.hostiles.some(isInvaderCreep)) flagRemoteInvader(creep);
    else if (threat.hostiles.some(isPlayerCreep)) flagRemotePlayer(creep);
  }

  if (isAssignedRemoteContested(creep) || (threat && threat.score > 0)) {
    cryFlight(creep);
    if (creep.room.name !== homeRoom) moveToRoom(creep, homeRoom);
    return;
  }

  settleFlight(creep);
  if (inTarget && !core) clearRemoteInvader(creep);

  if (creep.room.name !== targetRoom) {
    moveToRoom(creep, targetRoom);
    return;
  }

  const source = Game.getObjectById(remoteSourceId) as Source | null;
  if (!source) {
    creep.memory.remoteSourceId = undefined;
    return;
  }

  const container = findOrUpdateContainer(creep, source);

  if (container) {
    if (!creep.pos.isEqualTo(container.pos)) {
      creep.moveTo(container, { reusePath: 30 });
      // Moving and harvesting are separate intents, so the last steps of the
      // walk out are still productive, including while a replacement overlaps
      // the miner it relieves.
      if (creep.pos.isNearTo(source)) harvest(creep, source);
      return;
    }
    if (container.hits < container.hitsMax * 0.5 && creep.store[RESOURCE_ENERGY] > 0) {
      creep.repair(container);
      return;
    }
    harvest(creep, source);
  } else {
    // Nothing else builds in remotes, so the miner finishes its own container.
    const site = source.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 1, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    })[0];
    if (site) {
      // Picking up is a separate intent from building, so gold lying at the
      // miner's feet keeps it building every tick; with none, it digs a full
      // load first. Building each dig as it came, a tick of each by turns,
      // raised Grimford's remote containers at five a tick, while three
      // thousand gold dug before them rotted beside one of them.
      const pile = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY,
      })[0];
      if (pile) creep.pickup(pile);
      const loaded = pile ? creep.store[RESOURCE_ENERGY] > 0 : creep.store.getFreeCapacity() === 0;
      if (loaded) {
        if (creep.build(site) === ERR_NOT_IN_RANGE) creep.moveTo(site, { reusePath: 30 });
        return;
      }
      if (pile) return;
    }
    if (harvest(creep, source) === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { reusePath: 30 });
    }
  }
}

// ERR_NOT_OWNER means someone else holds the controller, so the source can't be
// mined. A player's claim makes the remote hostile; an Invader reservation is
// cleared by our reserver, so just step away for a while.
function harvest(creep: Creep, source: Source): ScreepsReturnCode {
  const res = creep.harvest(source);
  if (res === ERR_NOT_OWNER) {
    if (creep.room.controller?.reservation?.username === "Invader") {
      creep.memory.remoteBackoffUntil = Game.time + REMOTE_DAMAGE_BACKOFF;
    } else {
      flagRemotePlayer(creep);
    }
  }
  return res;
}

function moveToRoom(creep: Creep, targetRoom: string) {
  creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30, range: 20 });
}

function findOrUpdateContainer(
  creep: Creep,
  source: Source
): StructureContainer | null {
  if (creep.memory.assignedContainerId) {
    const cached = Game.getObjectById(
      creep.memory.assignedContainerId
    ) as StructureContainer | null;
    if (cached) return cached;
    creep.memory.assignedContainerId = undefined;
  }

  const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
    filter: (s): s is StructureContainer =>
      s.structureType === STRUCTURE_CONTAINER,
  }) as StructureContainer[];

  if (containers.length === 0) return null;

  const container = containers[0];
  creep.memory.assignedContainerId = container.id;

  updateRemoteContainerMemory(creep, source, container);

  return container;
}

function updateRemoteContainerMemory(
  creep: Creep,
  source: Source,
  container: StructureContainer
) {
  const homeMemory = Memory.rooms[creep.memory.homeRoom!];
  if (!homeMemory?.remoteRooms) return;

  const remoteEntry = homeMemory.remoteRooms.find(
    (r) => r.roomName === creep.room.name
  );
  if (!remoteEntry) return;

  const sourceEntry = remoteEntry.sources.find(
    (s) => s.sourceId === source.id
  );
  if (sourceEntry) sourceEntry.containerId = container.id;
}
