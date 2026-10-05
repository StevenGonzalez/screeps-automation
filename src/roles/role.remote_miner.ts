import { remoteThreats, isInvaderCreep, isPlayerCreep, findInvaderCore } from "../services/services.combat";
import {
  isAssignedRemoteContested,
  isAssignedRemoteInvaded,
  isSafeRefuge,
  flagRemoteInvader,
  flagRemotePlayer,
  flagRemoteDamage,
  clearRemoteInvader,
  noteWalk,
  standsIn,
} from "../services/services.creep";
import { cryFlight, cryGlut, heraldRefuge, heraldWaystation, settleFlight } from "../services/services.herald";

const REMOTE_DAMAGE_BACKOFF = 300;

// Gold the merchants have not yet come for piles up beside a full container,
// where it rots. With this much lying there a peddler stops digging until the
// merchants have taken some: each dig costs an intent's CPU and only feeds the
// rot. Four peddlers in the Crow Glen and the Bleak Vale dug onto piles of
// thousands while the realm ran short of CPU.
const GLUT_PILE = 1000;

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
    // A walk out broken off to wait at home is no measure of the road.
    creep.memory.walk ??= 0;
    const refuge = refugeFrom(creep, homeRoom);
    if (!standsIn(creep, refuge)) fleeTo(creep, refuge);
    return;
  }

  const inTarget = creep.room.name === targetRoom;
  const threats = inTarget ? remoteThreats(creep.room) : [];
  const core = inTarget ? findInvaderCore(creep.room) : null;
  if (core) flagRemoteInvader(creep);
  else if (threats.some(isInvaderCreep)) flagRemoteInvader(creep);
  else if (threats.some(isPlayerCreep)) flagRemotePlayer(creep);

  if (isAssignedRemoteContested(creep) || threats.length > 0) {
    cryFlight(creep);
    creep.memory.walk ??= 0;
    const refuge = refugeFrom(creep, homeRoom);
    if (!standsIn(creep, refuge)) fleeTo(creep, refuge);
    return;
  }

  settleFlight(creep);
  delete creep.memory.refuge;
  delete creep.memory.hid;
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
  // A relief that comes while the peddler it relieves still holds the post
  // waits a step back from the source, so it has arrived within two tiles.
  if (creep.memory.walk === undefined && creep.pos.inRangeTo(source, 2)) noteWalk(creep, CREEP_LIFE_TIME);

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
    if (container.store.getFreeCapacity(RESOURCE_ENERGY) === 0 && pileAt(creep.pos) >= GLUT_PILE) {
      cryGlut(creep);
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
        const res = creep.build(site);
        if (res === ERR_NOT_IN_RANGE) creep.moveTo(site, { reusePath: 30 });
        else if (res === OK && site.progressTotal - site.progress <= creep.getActiveBodyparts(WORK) * BUILD_POWER) {
          heraldWaystation(creep, site);
        }
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

// Where a peddler waits out trouble in its remote, chosen once as it flees.
// Raiders keep to the remote they raid, so a peddler, slow off the road,
// crosses the remote's nearest border into a room safe to stand in rather
// than the whole remote to reach home. Peddler Nesta walked twenty-seven tiles
// of the Bleak Vale toward Grimford with the highway four tiles behind her,
// and the raider met her on the way. Another player's creeps can follow over
// a border, so a peddler fleeing them goes home.
function refugeFrom(creep: Creep, homeRoom: string): string {
  if (creep.memory.refuge) return creep.memory.refuge;
  if (creep.room.name !== creep.memory.targetRoom || !isAssignedRemoteInvaded(creep)) return homeRoom;
  if (remoteThreats(creep.room).some(isPlayerCreep)) return homeRoom;
  const exits = Game.map.describeExits(creep.room.name) ?? {};
  const beyond = (p: RoomPosition) =>
    exits[(p.x === 0 ? "7" : p.x === 49 ? "3" : p.y === 0 ? "1" : "5") as ExitKey];
  const me = creep.owner.username;
  const exit = creep.pos.findClosestByPath(FIND_EXIT, {
    filter: (p: RoomPosition) => {
      const room = beyond(p);
      return room === homeRoom || (!!room && isSafeRefuge(room, me));
    },
    algorithm: "dijkstra",
    costCallback: shunRaiders(remoteThreats(creep.room)),
  });
  const refuge = (exit && beyond(exit)) || homeRoom;
  creep.memory.refuge = refuge;
  return refuge;
}

function moveToRoom(creep: Creep, targetRoom: string) {
  creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30, range: 20 });
}

// A fleeing peddler keeps this far from a raider where it can: a raider's bow
// reaches three tiles.
const RAIDER_BERTH = 4;
// What a tile that close to a raider costs to cross, against 2 for open
// ground, so a long way round is taken before a short one past the raider.
const RAIDER_BERTH_COST = 60;

// The nearest border was the nearest by the walk alone, wherever the raiders
// stood. In the Crow Glen a raider came in over the east border the tick
// Peddler Godric set off for it, and Godric walked into its arms.
function fleeTo(creep: Creep, refuge: string): void {
  // Told as it comes over the border, not as it sets off: Godric was told to
  // have slipped into the Sorrow Vale, then to have fallen in the Crow Glen.
  if (creep.room.name === refuge && refuge !== creep.memory.homeRoom && !creep.memory.hid) {
    creep.memory.hid = true;
    heraldRefuge(creep, creep.memory.targetRoom!, refuge);
  }
  const raiders = remoteThreats(creep.room);
  if (raiders.length === 0) {
    moveToRoom(creep, refuge);
    return;
  }
  // The raiders move, so the way round them is found again every few steps.
  creep.moveTo(new RoomPosition(25, 25, refuge), { reusePath: 5, range: 20, costCallback: shunRaiders(raiders) });
}

function shunRaiders(raiders: Creep[]) {
  return (roomName: string, matrix: CostMatrix): CostMatrix => {
    const terrain = Game.map.getRoomTerrain(roomName);
    for (const raider of raiders) {
      if (raider.pos.roomName !== roomName) continue;
      const { x: rx, y: ry } = raider.pos;
      for (let x = Math.max(0, rx - RAIDER_BERTH); x <= Math.min(49, rx + RAIDER_BERTH); x++) {
        for (let y = Math.max(0, ry - RAIDER_BERTH); y <= Math.min(49, ry + RAIDER_BERTH); y++) {
          // A cost set on a wall would let the path through it.
          if (terrain.get(x, y) & TERRAIN_MASK_WALL) continue;
          if (matrix.get(x, y) < RAIDER_BERTH_COST) matrix.set(x, y, RAIDER_BERTH_COST);
        }
      }
    }
    return matrix;
  };
}

function pileAt(pos: RoomPosition): number {
  let gold = 0;
  for (const r of pos.lookFor(LOOK_RESOURCES)) if (r.resourceType === RESOURCE_ENERGY) gold += r.amount;
  return gold;
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
