/**
 * Remote Mining Manager
 *
 * Manages remote mining operations for a room
 * - Assigns remote rooms based on scouting data
 * - Tracks active operations
 * - Manages creep assignments
 * - Handles threat response and evacuation
 */

import { getRoomMemory } from "../global.memory";
import {
  findBestRemoteRooms,
  isRemoteRoomSafe,
  RemoteRoomScan,
} from "../scout/remote";

export interface RemoteOperation {
  roomName: string;
  homeRoom: string;
  active: boolean;
  sources: { id: Id<Source>; pos: { x: number; y: number } }[];
  assignedCreeps: {
    miners: Id<Creep>[];
    haulers: Id<Creep>[];
    reserver?: Id<Creep>;
  };
  lastThreatCheck: number;
  threatened: boolean;
  containers: Id<StructureContainer>[];
  lastContainerUpdate?: number;
}

export interface RemoteManagerState {
  operations: { [roomName: string]: RemoteOperation };
  lastScan: number;
  maxRemotes: number;
}

/**
 * Run remote mining manager for a room
 */
export function runRemoteManager(room: Room): RemoteManagerState {
  const mem = getRoomMemory(room.name);
  mem.remote = mem.remote || {};
  const remoteMem = mem.remote as any;
  remoteMem.manager = remoteMem.manager || {
    operations: {},
    lastScan: 0,
    maxRemotes: 0,
  };

  const state: RemoteManagerState = remoteMem.manager;

  // Determine max remotes based on RCL
  state.maxRemotes = getMaxRemotes(room);

  // Scan for new remote rooms every 1000 ticks
  if (Game.time - state.lastScan > 1000) {
    scanAndAssignRemotes(room, state);
    state.lastScan = Game.time;
  }

  // Update existing operations
  for (const roomName in state.operations) {
    const op = state.operations[roomName];
    updateOperation(room, op);
  }

  // Clean up dead operations
  cleanupOperations(state);

  return state;
}

/**
 * Scan for remote rooms and assign best ones
 */
function scanAndAssignRemotes(room: Room, state: RemoteManagerState): void {
  console.log(`[RemoteMgr] ${room.name}: Scanning for remote rooms...`);

  const bestRemotes = findBestRemoteRooms(room, state.maxRemotes);

  console.log(
    `[RemoteMgr] ${room.name}: Found ${bestRemotes.length} viable remotes`
  );

  // Assign new remotes
  for (const scan of bestRemotes) {
    if (!state.operations[scan.roomName]) {
      console.log(
        `[RemoteMgr] ${room.name}: Starting operation in ${
          scan.roomName
        } (score: ${scan.score.toFixed(1)})`
      );
      state.operations[scan.roomName] = {
        roomName: scan.roomName,
        homeRoom: room.name,
        active: true,
        sources: scan.sources,
        assignedCreeps: {
          miners: [],
          haulers: [],
        },
        lastThreatCheck: Game.time,
        threatened: false,
        containers: [],
      };
    }
  }

  // Deactivate operations not in best list
  for (const roomName in state.operations) {
    if (!bestRemotes.find((s) => s.roomName === roomName)) {
      if (state.operations[roomName].active) {
        console.log(
          `[RemoteMgr] ${room.name}: Deactivating operation in ${roomName} (no longer viable)`
        );
        state.operations[roomName].active = false;
      }
    }
  }
}

/**
 * Update a remote operation
 */
function updateOperation(homeRoom: Room, op: RemoteOperation): void {
  if (!op.active) return;

  // Check for threats every 10 ticks
  if (Game.time - op.lastThreatCheck > 10) {
    op.threatened = !isRemoteRoomSafe(op.roomName);
    op.lastThreatCheck = Game.time;

    if (op.threatened) {
      console.log(
        `⚠️ [RemoteMgr] ${homeRoom.name}: ${op.roomName} is under threat! Evacuating...`
      );
    }
  }

  // Update assigned creeps (remove dead ones)
  op.assignedCreeps.miners = op.assignedCreeps.miners.filter((id) =>
    Game.getObjectById(id)
  );
  op.assignedCreeps.haulers = op.assignedCreeps.haulers.filter((id) =>
    Game.getObjectById(id)
  );
  if (op.assignedCreeps.reserver) {
    const reserver = Game.getObjectById(op.assignedCreeps.reserver);
    if (!reserver) {
      delete op.assignedCreeps.reserver;
    }
  }

  // Update container list (CACHED: only update every 100 ticks - containers are static)
  if (!op.lastContainerUpdate || Game.time - op.lastContainerUpdate > 100) {
    const room = Game.rooms[op.roomName];
    if (room) {
      const containers = room.find(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      }) as StructureContainer[];
      op.containers = containers.map((c) => c.id);
      op.lastContainerUpdate = Game.time;
    }
  }
}

/**
 * Clean up dead operations
 */
function cleanupOperations(state: RemoteManagerState): void {
  for (const roomName in state.operations) {
    const op = state.operations[roomName];
    // Remove if inactive and no assigned creeps
    if (
      !op.active &&
      op.assignedCreeps.miners.length === 0 &&
      op.assignedCreeps.haulers.length === 0 &&
      !op.assignedCreeps.reserver
    ) {
      delete state.operations[roomName];
    }
  }
}

/**
 * Get max remotes based on RCL
 */
function getMaxRemotes(room: Room): number {
  const rcl = room.controller?.level || 0;
  if (rcl < 4) return 0; // No remotes until RCL 4
  if (rcl < 6) return 1; // 1 remote at RCL 4-5
  if (rcl < 7) return 2; // 2 remotes at RCL 6
  return 3; // 3 remotes at RCL 7-8
}

/**
 * Get required creeps for a remote operation
 */
export function getRemoteCreepNeeds(op: RemoteOperation): {
  miners: number;
  haulers: number;
  reserver: boolean;
} {
  if (!op.active || op.threatened) {
    return { miners: 0, haulers: 0, reserver: false };
  }

  // 1 miner per source
  const minersNeeded = op.sources.length;

  // Calculate haulers needed based on distance
  // Rough estimate: 1 hauler per 50 tiles of distance
  const room = Game.rooms[op.homeRoom];
  const remoteRoom = Game.rooms[op.roomName];
  let haulersNeeded = op.sources.length; // At least 1 per source

  if (room && remoteRoom) {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    const source = remoteRoom.find(FIND_SOURCES)[0];
    if (spawn && source) {
      const distance = PathFinder.search(spawn.pos, {
        pos: source.pos,
        range: 1,
      }).path.length;
      haulersNeeded = Math.max(1, Math.ceil(distance / 50)) * op.sources.length;
    }
  }

  // Need a reserver if room has controller
  const needsReserver = remoteRoom?.controller ? true : false;

  return {
    miners: minersNeeded,
    haulers: haulersNeeded,
    reserver: needsReserver,
  };
}

/**
 * Assign a creep to a remote operation
 */
export function assignCreepToRemote(
  creep: Creep,
  op: RemoteOperation,
  role: "miner" | "hauler" | "reserver"
): void {
  if (role === "miner") {
    if (!op.assignedCreeps.miners.includes(creep.id)) {
      op.assignedCreeps.miners.push(creep.id);
      (creep.memory as any).remoteRoom = op.roomName;
      (creep.memory as any).homeRoom = op.homeRoom;
    }
  } else if (role === "hauler") {
    if (!op.assignedCreeps.haulers.includes(creep.id)) {
      op.assignedCreeps.haulers.push(creep.id);
      (creep.memory as any).remoteRoom = op.roomName;
      (creep.memory as any).homeRoom = op.homeRoom;
    }
  } else if (role === "reserver") {
    op.assignedCreeps.reserver = creep.id;
    (creep.memory as any).remoteRoom = op.roomName;
    (creep.memory as any).homeRoom = op.homeRoom;
  }
}

/**
 * Get all active remote operations for a room
 */
export function getActiveRemoteOperations(roomName: string): RemoteOperation[] {
  const mem = getRoomMemory(roomName);
  const remoteMem = mem.remote as any;
  if (!remoteMem || !remoteMem.manager) return [];

  const state: RemoteManagerState = remoteMem.manager;
  return Object.values(state.operations).filter((op) => op.active);
}

/**
 * Find a source for a remote miner
 */
export function findAvailableRemoteSource(
  op: RemoteOperation
): { id: Id<Source>; pos: { x: number; y: number } } | null {
  // Find a source that doesn't have a miner assigned yet
  for (const source of op.sources) {
    const assigned = op.assignedCreeps.miners.find((minerId) => {
      const miner = Game.getObjectById(minerId);
      return miner && (miner.memory as any).sourceId === source.id;
    });

    if (!assigned) {
      return source;
    }
  }

  return null;
}
