import { getThreatInfo } from "../services/services.combat";
import {
  abandonAfterFailedAttempt,
  completeOp,
  removeOp,
  cleanupDrainOps,
  advanceMilitaryQueue,
} from "./orchestrator.military.ops";
import { runWarCouncil } from "./orchestrator.military.council";
import { runDefenseCouncil, requestAllyDefense } from "./orchestrator.military.defense";
import {
  RALLY_RANGE,
  getSquadContext,
  getSquadMembers,
  squadMet,
  squadBoostReady,
} from "./orchestrator.military.squad";

export {
  getOffensiveOp,
  cancelOp,
  getDrainOp,
  getDrainOpsForHome,
  launchDrain,
  stopDrain,
  getDrainOps,
  recommendComposition,
  launchOp,
  enqueueOp,
  dequeueOp,
  getMilitaryQueue,
  setFormation,
  setTactic,
  getOffensiveOps,
} from "./orchestrator.military.ops";
export { recordRoomIntel } from "./orchestrator.military.council";
export {
  getDefenseOp,
  getDefenders,
  runDefensiveKnight,
  runDefensiveWizard,
  runDefensiveCleric,
} from "./orchestrator.military.defense";
export {
  getSquadContext,
  runOffensiveKnight,
  runOffensiveWizard,
  runOffensiveCleric,
  runOffensiveSieger,
  shouldHoldForDrain,
  runOffensiveDrainer,
  runStandaloneDrainer,
} from "./orchestrator.military.squad";

declare global {
  interface WarCouncilMemory {
    lastAutoNukeTick?: number;
    nukedUntil?: Record<string, number>;
    // Owner (or room) -> tick until which auto-attack leaves it alone after a failed op.
    targetCooldown?: Record<string, number>;
    // Player -> last tick one of their armed creeps was seen in our rooms or remotes.
    hostilePlayers?: Record<string, number>;
  }

  interface MilitaryOp {
    attempts?: number;
    holdSince?: number;
  }
}

const REGROUP_HP_THRESHOLD = 0.85;

const CLEARED_TICKS_NEEDED = 10;

const FORMING_TIMEOUT = 1500;

const FRAGMENT_TIMEOUT = 300;

const RETREAT_THRESHOLD: Record<SquadTactic, number> = {
  assault: 0.4,
  siege: 0.35,
  raid: 0.55,
  defend: 0.3,
  retreat: 1.1,
};

export function loop(): void {
  runWarCouncil();
  runDefenseCouncil();
  requestAllyDefense();
  cleanupDrainOps();

  migrateMilitaryOps();

  const ops = Memory.militaryOps;
  if (!ops) return;

  for (const homeRoomName in ops) {
    const op = ops[homeRoomName];

    op.formation = op.formation ?? "box";
    op.tactic = op.tactic ?? "assault";
    op.requiredSiege = op.requiredSiege ?? 0;
    op.requiredDrainers = op.requiredDrainers ?? 0;

    const homeRoom = Game.rooms[op.homeRoom];
    if (!homeRoom?.controller?.my) {
      removeOp(op);
      continue;
    }

    const members = getSquadMembers(op);

    switch (op.phase) {
      case "forming":    runForming(op, members); break;
      case "rallying":   runRallying(op, homeRoom, members); break;
      case "attacking":  runAttacking(op, members); break;
      case "retreating": runRetreating(op, members); break;
    }
  }

  advanceMilitaryQueue();
}

function migrateMilitaryOps(): void {
  if (!Memory.militaryOps) Memory.militaryOps = {};
  const legacy = Memory.militaryOp;
  if (legacy) {
    if (!Memory.militaryOps[legacy.homeRoom]) {
      Memory.militaryOps[legacy.homeRoom] = legacy;
    }
    delete Memory.militaryOp;
  }
}

function runForming(op: MilitaryOp, members: Creep[]): void {
  if (Game.time - op.startedAt > FORMING_TIMEOUT) {
    console.log(`[Military] ${op.targetRoom}: Forming timeout - squad could not be assembled, aborting`);
    removeOp(op);
    return;
  }

  if (squadMet(op, members)) {
    if (!squadBoostReady(members)) return;
    op.phase = "rallying";
    console.log(`[Military] ${op.targetRoom}: Squad formed (${members.length} creeps) - rallying at spawn`);
  }
}

function runRallying(op: MilitaryOp, homeRoom: Room, members: Creep[]): void {
  if (!squadMet(op, members)) {
    op.phase = "forming";
    op.startedAt = Game.time;
    console.log(`[Military] ${op.targetRoom}: Squad incomplete during rally - reforming`);
    return;
  }

  const spawn = homeRoom.find(FIND_MY_SPAWNS)[0];
  if (!spawn) return;

  const allRallied = members.every(
    (c) => c.room.name === op.homeRoom && c.pos.getRangeTo(spawn) <= RALLY_RANGE
  );

  if (allRallied && squadBoostReady(members)) {
    op.phase = "attacking";
    console.log(`[Military] ${op.targetRoom}: Squad rallied - advancing in ${op.formation}/${op.tactic}!`);
  }
}

function runAttacking(op: MilitaryOp, members: Creep[]): void {
  if (members.length === 0) {
    if (abandonAfterFailedAttempt(op, "All squad members lost")) return;
    op.phase = "forming";
    op.startedAt = Game.time;
    op.clearedSince = undefined;
    op.regroupSince = undefined;
    console.log(`[Military] ${op.targetRoom}: All squad members lost - reforming`);
    return;
  }

  const ctx = getSquadContext(op);

  if (!ctx.cohesive) {
    if (!op.regroupSince) op.regroupSince = Game.time;
    else if (Game.time - op.regroupSince > FRAGMENT_TIMEOUT) {
      op.phase = "retreating";
      op.regroupSince = undefined;
      op.clearedSince = undefined;
      console.log(`[Military] ${op.targetRoom}: Squad fragmented too long - pulling back to regroup`);
      return;
    }
  } else {
    op.regroupSince = undefined;
  }

  if (op.tactic !== "retreat" && ctx.avgHpPct < RETREAT_THRESHOLD[op.tactic]) {
    op.phase = "retreating";
    op.clearedSince = undefined;
    op.regroupSince = undefined;
    console.log(`[Military] ${op.targetRoom}: Squad at ${Math.round(ctx.avgHpPct * 100)}% - retreating to regroup`);
    return;
  }

  const targetRoom = Game.rooms[op.targetRoom];
  if (!targetRoom) {
    op.clearedSince = undefined;
    return;
  }

  if (targetRoom.controller?.safeMode) {
    console.log(`[Military] ${op.targetRoom}: Safe mode active - standing down`);
    removeOp(op);
    return;
  }

  if (op.tactic === "defend") return;

  const hostiles = getThreatInfo(targetRoom).hostiles;
  const ownedStructs = targetRoom.find(FIND_HOSTILE_STRUCTURES, {
    filter: (s) => s.structureType !== STRUCTURE_CONTROLLER && s.structureType !== STRUCTURE_RAMPART,
  });
  const cleared =
    op.tactic === "raid"
      ? hostiles.length === 0 &&
        !ownedStructs.some(
          (s) => s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_TOWER
        )
      : hostiles.length === 0 && ownedStructs.length === 0;

  if (cleared) {
    if (!op.clearedSince) {
      op.clearedSince = Game.time;
    } else if (Game.time - op.clearedSince >= CLEARED_TICKS_NEEDED) {
      console.log(`[Military] ${op.targetRoom}: Objective complete - standing down.`);
      completeOp(op);
    }
  } else {
    op.clearedSince = undefined;
  }
}

function runRetreating(op: MilitaryOp, members: Creep[]): void {
  if (members.length === 0) {
    // A manual retreat with nobody left is finished, not a reason to respawn.
    if (op.tactic === "retreat") {
      removeOp(op);
      return;
    }
    if (abandonAfterFailedAttempt(op, "All squad members lost")) return;
    op.phase = "forming";
    op.startedAt = Game.time;
    op.retreatSince = undefined;
    return;
  }

  if (!op.retreatSince) op.retreatSince = Game.time;
  const timedOut = Game.time - op.retreatSince > FRAGMENT_TIMEOUT;

  const allHome = members.every((c) => c.room.name === op.homeRoom);
  if (!allHome && !timedOut) return;

  const ctx = getSquadContext(op);
  if (ctx.avgHpPct < REGROUP_HP_THRESHOLD && !timedOut) return;

  if (op.tactic === "retreat") return;

  op.retreatSince = undefined;
  if (squadMet(op, members)) {
    op.phase = "rallying";
    console.log(`[Military] ${op.targetRoom}: Regrouped - re-rallying for another push (${op.tactic})`);
  } else {
    if (abandonAfterFailedAttempt(op, "Squad depleted after retreat")) return;
    op.phase = "forming";
    op.startedAt = Game.time;
    console.log(`[Military] ${op.targetRoom}: Squad depleted after retreat - reforming`);
  }
}
