// Remote mining bookkeeping shared by spawning, which decides which remote
// sources are worth working, and structures, which lays roads to them.

// Roads out to a remote pay once the home has storage to haul into and the
// energy to spare on sites. Before that the haulers walk.
const REMOTE_ROAD_MIN_RCL = 4;

export function remoteRoadsEnabled(home: Room): boolean {
  return (home.controller?.level ?? 0) >= REMOTE_ROAD_MIN_RCL && !!home.storage;
}

// Terrain and walls barely change, so a path is measured once and kept until
// its origin or target changes, with a slow refresh for the odd new wall.
const REMOTE_PATH_REFRESH = 10_000;
// An incomplete search means the source cannot be reached from home. The
// length stands in for "too far to be worth it" in the profit estimate.
export const UNREACHABLE_REMOTE_PATH = 999;

// At most one search per home per tick; a source still waiting its turn keeps
// whatever it had, and the caller falls back to an estimate.
const lastSearchTick: Record<string, number> = {};

function roadCostMatrix(roomName: string): CostMatrix {
  const cm = new PathFinder.CostMatrix();
  const room = Game.rooms[roomName];
  if (!room) return cm;
  for (const s of room.find(FIND_STRUCTURES)) {
    if (s.structureType === STRUCTURE_ROAD) {
      if (cm.get(s.pos.x, s.pos.y) === 0) cm.set(s.pos.x, s.pos.y, 1);
    } else if (s.structureType === STRUCTURE_RAMPART) {
      if (!(s as StructureRampart).my) cm.set(s.pos.x, s.pos.y, 255);
    } else if ((OBSTACLE_OBJECT_TYPES as string[]).includes(s.structureType)) {
      cm.set(s.pos.x, s.pos.y, 255);
    }
  }
  return cm;
}

// Path length from the home's storage (or spawn, before there is one) to a
// remote source's container, or the source itself before the container is
// up. Cached on the source's memory entry along with the path's tiles in the
// remote room, which is where remote roads get laid. The search is confined
// to the home and the remote so the length is the trip haulers actually make
// and every tile is in a room we plan for. Needs vision of the target, so a
// source we cannot see keeps its cached value, if any.
export function getRemoteSourcePathLength(
  home: Room,
  remote: RemoteRoomData,
  src: RemoteSourceData
): number | undefined {
  const origin =
    home.storage ?? (home.find(FIND_MY_SPAWNS)[0] as StructureSpawn | undefined);
  const container = src.containerId ? Game.getObjectById(src.containerId) : null;
  const target: Source | StructureContainer | null =
    container ?? Game.getObjectById(src.sourceId);
  if (!origin || !target) return src.pathLength;

  const key = `${origin.id}:${target.id}`;
  const fresh =
    src.pathKey === key &&
    src.pathTick !== undefined &&
    Game.time - src.pathTick < REMOTE_PATH_REFRESH;
  if (fresh || lastSearchTick[home.name] === Game.time) return src.pathLength;
  lastSearchTick[home.name] = Game.time;

  const result = PathFinder.search(
    origin.pos,
    { pos: target.pos, range: 1 },
    {
      plainCost: 2,
      swampCost: 10,
      maxOps: 4000,
      roomCallback: (rn) =>
        rn === home.name || rn === remote.roomName ? roadCostMatrix(rn) : false,
    }
  );
  src.pathKey = key;
  src.pathTick = Game.time;
  if (result.incomplete) {
    src.pathLength = UNREACHABLE_REMOTE_PATH;
    src.roadTiles = undefined;
  } else {
    src.pathLength = result.path.length;
    src.roadTiles = result.path
      .filter((p) => p.roomName === remote.roomName)
      .map((p) => `${p.x},${p.y}`)
      .join(";");
  }
  return src.pathLength;
}
