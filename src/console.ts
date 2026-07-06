import { resolveChain, getStockForCompound } from "./services/services.labs";
import {
  cancelOp,
  launchOp,
  enqueueOp,
  dequeueOp,
  getMilitaryQueue,
  getOffensiveOps,
  recommendComposition,
  setFormation,
  setTactic,
  launchDrain,
  stopDrain,
  getDrainOps,
} from "./orchestrators/orchestrator.military";
import { getThreatInfo, getThreatSeverity, isBlockaded } from "./services/services.combat";
import { getCpuStats } from "./services/services.profiler";
import {
  launchSkOp,
  cancelSkOp,
  getSkMembers,
  isOpPaused,
} from "./orchestrators/orchestrator.sourcekeeper";
import {
  ROLE_KNIGHT,
  ROLE_WIZARD,
  ROLE_CLERIC,
  ROLE_SIEGER,
  ROLE_DRAINER,
  ROLE_POWER_ATTACKER,
  ROLE_POWER_HEALER,
  ROLE_POWER_CARRIER,
  ROLE_DEPOSIT_MINER,
  ROLE_DEPOSIT_HAULER,
} from "./config/config.roles";
import {
  rankExpansionCandidates,
  enqueueExpansion,
  dequeueExpansion,
  getExpansionQueue,
} from "./orchestrators/orchestrator.expansion";
import {
  describeFactories,
  forceCommodity,
  setAuto as setFactoryAuto,
} from "./orchestrators/orchestrator.factory";
import { describeNukers, launchNukeFrom } from "./orchestrators/orchestrator.nuker";

const VALID_FORMATIONS: SquadFormation[] = ["line", "box", "wedge", "scatter"];
const VALID_TACTICS: SquadTactic[] = ["assault", "siege", "raid", "defend", "retreat"];

export function setupConsole() {
  (Game as any).arca = {
    // Show ranked expansion candidates from lookout scout data
    expand: () => {
      const candidates = rankExpansionCandidates();
      if (candidates.length === 0) {
        console.log("[ARCA] No expansion candidates in scout data — send lookouts first");
        return;
      }
      console.log("[ARCA] Top expansion candidates:");
      for (const c of candidates.slice(0, 5)) {
        console.log(
          `  ${c.room}  score=${c.score}  sources=${c.sources}  dist=${c.dist}  fundedBy=${c.homeRoom}`
        );
      }
      console.log("[ARCA] Claim now with Game.arca.claim('ROOM_NAME') or line up with Game.arca.queueExpand('ROOM_NAME')");
    },

    // Add a target to the expansion PIPELINE. Only one expansion runs at a time; the
    // queue auto-advances to the next target when the active one completes/aborts.
    //   Game.arca.queueExpand('W5N5')            → closest healthy home funds it at pop time
    //   Game.arca.queueExpand('W5N5', 'W1N1')    → prefer a specific funding home
    queueExpand: (roomName: string, homeRoom?: string) => {
      if (!roomName) {
        console.log("[ARCA] Usage: Game.arca.queueExpand('W5N5')  or  Game.arca.queueExpand('W5N5', 'W1N1')");
        return;
      }
      const err = enqueueExpansion(roomName, homeRoom);
      if (err) {
        console.log(`[ARCA] Cannot queue ${roomName} — ${err}`);
        return;
      }
      console.log(`[ARCA] Queued expansion to ${roomName}${homeRoom ? ` (prefer ${homeRoom})` : ""} — ${getExpansionQueue().length} queued`);
    },

    // Remove a target from the expansion queue.
    dequeueExpand: (roomName: string) => {
      if (!roomName) {
        console.log("[ARCA] Usage: Game.arca.dequeueExpand('W5N5')");
        return;
      }
      if (dequeueExpansion(roomName)) console.log(`[ARCA] Removed ${roomName} from the expansion queue`);
      else console.log(`[ARCA] ${roomName} was not in the expansion queue`);
    },

    // Toggle / inspect automatic GCL-driven expansion. When ON, the bot claims the
    // best scouted candidate on its own whenever GCL frees a slot and a healthy
    // home room can fund it — no manual claim() needed.
    autoexpand: (enabled?: boolean) => {
      if (enabled === undefined) {
        console.log(`[AutoExpand] ${Memory.autoExpand ? "ON" : "OFF"}`);
        return;
      }
      Memory.autoExpand = enabled;
      console.log(`[AutoExpand] ${enabled ? "ENABLED" : "DISABLED"}`);
    },

    // Trigger expansion to a target room
    claim: (roomName: string) => {
      if (!roomName) {
        console.log("[ARCA] Usage: Game.arca.claim('W2N1')");
        return;
      }

      if (Memory.expansion) {
        console.log(
          `[ARCA] Already expanding to ${Memory.expansion.roomName} — cancel first with Game.arca.cancel()`
        );
        return;
      }

      // GCL check
      const myRoomCount = Object.values(Game.rooms).filter(
        (r) => r.controller?.my
      ).length;
      if (Game.gcl.level <= myRoomCount) {
        console.log(
          `[ARCA] GCL ${Game.gcl.level} does not allow another room (have ${myRoomCount}) — need GCL ${myRoomCount + 1}`
        );
        return;
      }

      // Target room validation (only possible if room is in vision)
      const targetRoom = Game.rooms[roomName];
      if (targetRoom) {
        if (targetRoom.controller?.my) {
          console.log(`[ARCA] ${roomName} is already yours`);
          return;
        }
        if (targetRoom.controller?.owner) {
          console.log(
            `[ARCA] ${roomName} is owned by ${targetRoom.controller.owner.username}`
          );
          return;
        }
      }

      // Pick the closest owned room to fund the operation
      const ownedRooms = Object.values(Game.rooms).filter(
        (r) => r.controller?.my
      );
      if (ownedRooms.length === 0) {
        console.log("[ARCA] No owned rooms to fund expansion");
        return;
      }
      const homeRoom = ownedRooms.reduce((best, r) => {
        const d = Game.map.getRoomLinearDistance(r.name, roomName);
        const bd = Game.map.getRoomLinearDistance(best.name, roomName);
        return d < bd ? r : best;
      }).name;

      Memory.expansion = {
        roomName,
        homeRoom,
        phase: "claiming",
        startedAt: Game.time,
      };
      console.log(
        `[ARCA] Expansion to ${roomName} queued — funded by ${homeRoom} (GCL ${Game.gcl.level}/${myRoomCount + 1})`
      );
    },

    // Show current expansion status + the queued pipeline.
    status: () => {
      const e = Memory.expansion;
      if (e) {
        const age = Game.time - e.startedAt;
        console.log(
          `[ARCA] ACTIVE: ${e.roomName} | Phase: ${e.phase} | Home: ${e.homeRoom} | Age: ${age} ticks`
        );
      } else {
        console.log("[ARCA] No active expansion");
      }
      const queue = getExpansionQueue();
      if (queue.length === 0) {
        console.log("[ARCA] Expansion queue is empty");
        return;
      }
      console.log(`[ARCA] Expansion queue (${queue.length}):`);
      queue.forEach((q, i) => {
        console.log(`  ${i + 1}. ${q.roomName}${q.homeRoom ? ` (prefer ${q.homeRoom})` : ""}  queuedAt=${q.queuedAt}`);
      });
    },

    // Abort an active expansion
    cancel: () => {
      if (!Memory.expansion) {
        console.log("[ARCA] No active expansion to cancel");
        return;
      }
      const room = Memory.expansion.roomName;
      delete Memory.expansion;
      console.log(`[ARCA] Expansion to ${room} cancelled`);
    },

    // Show lab system status for all owned rooms
    labs: () => {
      let found = false;
      for (const rn in Game.rooms) {
        const room = Game.rooms[rn];
        if (!room.controller?.my) continue;
        found = true;
        const ls = room.memory.labSystem;
        if (!ls) {
          console.log(`[Labs] ${rn}: no lab system (need RCL 6+ and 3+ labs)`);
          continue;
        }
        const active = ls.activeCompound ?? "idle";
        const inputCount = ls.inputLabIds?.length ?? 0;
        const outputCount = ls.outputLabIds?.length ?? 0;
        console.log(
          `[Labs] ${rn}: active=${active}  queue=${ls.queue.length}  inputs=${inputCount}  outputs=${outputCount}  auto=${ls.autoEnabled !== false}`
        );
        if (ls.inputCompounds) {
          console.log(`  Reagents: ${ls.inputCompounds[0]} + ${ls.inputCompounds[1]}`);
        }
        if (ls.queue.length > 0) {
          console.log(`  Queue: ${ls.queue.map((e) => `${e.compound}×${e.amount}`).join(", ")}`);
        }
        // Stock report for auto-production compounds
        const targets: Record<string, number> = {
          XUH2O: 3000, XUHO2: 3000, XKHO2: 3000,
          XZHO2: 2000, XGH2O: 3000, OH: 10000, G: 5000,
        };
        const stockLines = Object.entries(targets)
          .map(([c, t]) => `${c}=${getStockForCompound(c, room)}/${t}`)
          .join("  ");
        console.log(`  Stock: ${stockLines}`);
      }
      if (!found) console.log("[Labs] No owned rooms found");
    },

    // Queue production of a compound in the specified room (or best available)
    produce: (compound: string, amount: number, roomName?: string) => {
      if (!compound || !amount) {
        console.log("[Labs] Usage: Game.arca.produce('XUHO2', 3000)  or  Game.arca.produce('XUHO2', 3000, 'W1N1')");
        return;
      }
      const candidates = Object.values(Game.rooms).filter(
        (r) => r.controller?.my && (roomName ? r.name === roomName : r.memory.labSystem?.inputLabIds?.length)
      );
      if (candidates.length === 0) {
        console.log(`[Labs] No room with labs found${roomName ? ` matching ${roomName}` : ""}`);
        return;
      }
      const room = candidates[0];
      if (!room.memory.labSystem) room.memory.labSystem = { queue: [] };
      const chain = resolveChain(compound, amount, room.storage ?? null);
      if (chain.length === 0) {
        console.log(`[Labs] ${room.name}: Nothing to queue — stock may already be sufficient`);
        return;
      }
      room.memory.labSystem.queue.push(...chain);
      console.log(
        `[Labs] ${room.name}: Queued ${chain.length} reaction(s) → ${compound}×${amount}: ` +
        chain.map((e) => `${e.compound}×${e.amount}`).join(", ")
      );
    },

    // Show inter-room resource network status
    network: () => {
      const ownedRooms = Object.values(Game.rooms).filter((r) => r.controller?.my);
      if (ownedRooms.length === 0) { console.log("[Network] No owned rooms"); return; }

      console.log("[Network] === Resource Network Status ===");
      for (const room of ownedRooms) {
        const storageEnergy = room.storage?.store[RESOURCE_ENERGY] ?? 0;
        const terminalEnergy = room.terminal?.store[RESOURCE_ENERGY] ?? 0;
        const cooldown = room.terminal?.cooldown ?? -1;
        const pending = room.memory.pendingSend;
        const pendingStr = pending
          ? `  PENDING: ${pending.amount} ${pending.resource} → ${pending.to} (loaded ${
              room.terminal?.store.getUsedCapacity(pending.resource as ResourceConstant) ?? 0
            }/${pending.loadTarget})`
          : "";
        console.log(
          `  ${room.name}: storage=${storageEnergy}  terminal=${terminalEnergy} (cd=${cooldown})${pendingStr}`
        );

        // Mineral stocks relevant to lab chains
        const minerals = ['H','O','Z','K','U','L','X'] as const;
        const stockParts = minerals.map((m) => {
          const s = (room.storage?.store.getUsedCapacity(m) ?? 0) + (room.terminal?.store.getUsedCapacity(m) ?? 0);
          return `${m}=${s}`;
        });
        console.log(`    Minerals: ${stockParts.join("  ")}`);
      }
    },

    // Launch an offensive military operation against a target room. Concurrency is one
    // op per home room: if the closest capable home is already busy, the op is QUEUED
    // and auto-starts when a home frees up. Pass an explicit homeRoom to force one.
    //   Game.arca.attack('W2N1')                      → box / assault, auto-scaled squad
    //   Game.arca.attack('W2N1', 'wedge', 'siege')    → pick formation + tactic
    //   Game.arca.attack('W2N1', 'box', 'assault', { enforcers: 4, medics: 2 })  → override crew
    //   Game.arca.attack('W2N1', 'box', 'assault', undefined, 'W1N1')  → force funding home
    attack: (
      roomName: string,
      formation: SquadFormation = "box",
      tactic: SquadTactic = "assault",
      composition?: { enforcers?: number; triggermen?: number; medics?: number; wreckers?: number; decoys?: number },
      homeRoomName?: string
    ) => {
      if (!roomName) {
        console.log("[Military] Usage: Game.arca.attack('W2N1', 'box', 'assault')");
        return;
      }
      if (!VALID_FORMATIONS.includes(formation)) {
        console.log(`[Military] Unknown formation '${formation}'. Use: ${VALID_FORMATIONS.join(", ")}`);
        return;
      }
      if (!VALID_TACTICS.includes(tactic) || tactic === "retreat") {
        console.log(`[Military] Unknown tactic '${tactic}'. Use: assault, siege, raid, defend`);
        return;
      }

      const targetRoom = Game.rooms[roomName];
      if (targetRoom?.controller?.my) {
        console.log(`[Military] ${roomName} is already yours`);
        return;
      }

      const ownedRooms = Object.values(Game.rooms).filter((r) => r.controller?.my);
      if (ownedRooms.length === 0) {
        console.log("[Military] No owned rooms to launch from");
        return;
      }

      // Resolve the funding home: explicit if given, else the closest owned room.
      let homeRoom: Room;
      if (homeRoomName) {
        const r = Game.rooms[homeRoomName];
        if (!r?.controller?.my) {
          console.log(`[Military] ${homeRoomName} is not a room you own`);
          return;
        }
        homeRoom = r;
      } else {
        homeRoom = ownedRooms.reduce((best, r) => {
          const d = Game.map.getRoomLinearDistance(r.name, roomName);
          const bd = Game.map.getRoomLinearDistance(best.name, roomName);
          return d < bd ? r : best;
        });
      }

      // Intelligent default composition scaled to known defenses, overridable per role.
      const rec = recommendComposition(roomName, tactic);
      const comp = {
        enforcers: composition?.enforcers ?? rec.enforcers,
        triggermen: composition?.triggermen ?? rec.triggermen,
        medics: composition?.medics ?? rec.medics,
        wreckers: composition?.wreckers ?? rec.wreckers,
        decoys: composition?.decoys ?? rec.decoys,
      };

      const err = launchOp(roomName, formation, tactic, comp, homeRoom.name);
      if (err) {
        // Home busy (or otherwise unavailable) → queue it to auto-start later.
        const qErr = enqueueOp(roomName, formation, tactic, comp, homeRoomName);
        if (qErr) {
          console.log(`[Military] Cannot launch or queue — ${err}; ${qErr}`);
          return;
        }
        console.log(`[Military] ${err} — queued ${roomName} to auto-start when a home frees up`);
        return;
      }
      console.log(
        `[Military] Op launched: ${homeRoom.name} → ${roomName}  ${formation}/${tactic}  ` +
        `crew=${comp.enforcers}E/${comp.triggermen}T/${comp.medics}M/${comp.wreckers}R/${comp.decoys}D`
      );
      console.log(`[Military] Spawning squad... track with Game.arca.squads()`);
    },

    // Remove a queued offensive target.
    dequeueAttack: (roomName: string) => {
      if (!roomName) {
        console.log("[Military] Usage: Game.arca.dequeueAttack('W2N1')");
        return;
      }
      if (dequeueOp(roomName)) console.log(`[Military] Removed ${roomName} from the offensive queue`);
      else console.log(`[Military] ${roomName} was not in the offensive queue`);
    },

    // Start a STANDALONE tower-drain: send decoys to bleed a room's tower energy ahead of
    // (and decoupled from) any assault. Persistent — it runs until you stopDrain it. Only
    // effective against opponents whose towers fire at un-killable targets; a disciplined
    // defender holds fire and it achieves nothing.
    //   Game.arca.drain('W2N1')              → 1 decoy, closest capable home
    //   Game.arca.drain('W2N1', 2)           → 2 decoys
    //   Game.arca.drain('W2N1', 2, 'W1N1')   → force funding home
    drain: (roomName: string, count = 1, homeRoomName?: string) => {
      if (!roomName) {
        console.log("[Drain] Usage: Game.arca.drain('W2N1', 1)");
        return;
      }
      const err = launchDrain(roomName, homeRoomName, count);
      if (err) {
        console.log(`[Drain] Cannot start — ${err}`);
        return;
      }
      const op = getDrainOps().find((o) => o.targetRoom === roomName);
      console.log(
        `[Drain] Draining ${roomName} with ${op?.drainers ?? count} decoy(s) from ${op?.homeRoom}. ` +
        `Stop with Game.arca.stopDrain('${roomName}')`
      );
    },

    // Stop a standalone drain; its decoys stand down and return home.
    stopDrain: (roomName: string) => {
      if (!roomName) {
        console.log("[Drain] Usage: Game.arca.stopDrain('W2N1')");
        return;
      }
      if (stopDrain(roomName)) console.log(`[Drain] Stopped draining ${roomName}`);
      else console.log(`[Drain] No active drain on ${roomName}`);
    },

    // List active standalone drains.
    drains: () => {
      const ops = getDrainOps();
      if (ops.length === 0) {
        console.log("[Drain] No active drains");
        return;
      }
      console.log(`[Drain] Active drains (${ops.length}):`);
      for (const op of ops) {
        const live = Object.values(Game.creeps).filter(
          (c) => c.memory.role === ROLE_DRAINER && c.memory.offensiveTarget === op.targetRoom
        ).length;
        const age = Game.time - op.startedAt;
        console.log(
          `  ${op.targetRoom} ← ${op.homeRoom}  decoys=${live}/${op.drainers}  age=${age}t`
        );
      }
    },

    // Change formation mid-battle: line | box | wedge | scatter. Applies to all active
    // ops, or just the op funded by `homeRoom` if given.
    formation: (name: SquadFormation, homeRoom?: string) => {
      if (!VALID_FORMATIONS.includes(name)) {
        console.log(`[Military] Unknown formation '${name}'. Use: ${VALID_FORMATIONS.join(", ")}`);
        return;
      }
      const n = setFormation(name, homeRoom);
      if (n === 0) {
        console.log("[Military] No matching active operation");
        return;
      }
      console.log(`[Military] Formation → ${name} (${n} op${n !== 1 ? "s" : ""})`);
    },

    // Change tactic mid-battle: assault | siege | raid | defend | retreat. Applies to
    // all active ops, or just the op funded by `homeRoom` if given.
    tactic: (name: SquadTactic, homeRoom?: string) => {
      if (!VALID_TACTICS.includes(name)) {
        console.log(`[Military] Unknown tactic '${name}'. Use: ${VALID_TACTICS.join(", ")}`);
        return;
      }
      const n = setTactic(name, homeRoom);
      if (n === 0) {
        console.log("[Military] No matching active operation");
        return;
      }
      console.log(`[Military] Tactic → ${name} (${n} op${n !== 1 ? "s" : ""})`);
    },

    // Recall and stand down operations. No arg → all ops; a home room → just that one.
    recall: (homeRoom?: string) => {
      const n = cancelOp(homeRoom);
      if (n === 0) {
        console.log(homeRoom ? `[Military] No active operation for ${homeRoom}` : "[Military] No active operations");
        return;
      }
      console.log(`[Military] Stood down ${n} operation${n !== 1 ? "s" : ""}${homeRoom ? ` (${homeRoom})` : ""}`);
    },

    // Show all active offensive ops + the offensive queue.
    squads: () => {
      const ops = getOffensiveOps();
      const queue = getMilitaryQueue();
      if (ops.length === 0 && queue.length === 0) {
        console.log("[Military] No active operations or queued targets");
        return;
      }

      for (const op of ops) {
        const age = Game.time - op.startedAt;
        console.log(`[Military] Op: ${op.homeRoom} → ${op.targetRoom}`);
        console.log(
          `  Phase: ${op.phase}  |  Formation: ${op.formation}  |  Tactic: ${op.tactic}  |  Age: ${age}t`
        );
        console.log(
          `  Required: ${op.requiredEnforcers}E / ${op.requiredTriggermen}T / ` +
          `${op.requiredMedics}M / ${op.requiredWreckers ?? 0}R / ${op.requiredDecoys ?? 0}D`
        );

        const members = Object.values(Game.creeps).filter(
          (c) => c.memory.offensiveTarget === op.targetRoom && c.memory.homeRoom === op.homeRoom
        );
        if (members.length === 0) {
          console.log("  Squad: none yet (still spawning)");
          continue;
        }

        const counts = {
          [ROLE_KNIGHT]: 0,
          [ROLE_WIZARD]: 0,
          [ROLE_CLERIC]: 0,
          [ROLE_SIEGER]: 0,
          [ROLE_DRAINER]: 0,
        } as Record<string, number>;
        let hpSum = 0;
        for (const c of members) {
          counts[c.memory.role] = (counts[c.memory.role] ?? 0) + 1;
          hpSum += c.hits / c.hitsMax;
        }
        const avgHp = Math.round((hpSum / members.length) * 100);
        const inTarget = members.filter((c) => c.room.name === op.targetRoom).length;
        console.log(
          `  Crew: ${counts[ROLE_KNIGHT]}E/${counts[ROLE_WIZARD]}T/` +
          `${counts[ROLE_CLERIC]}M/${counts[ROLE_SIEGER]}R/${counts[ROLE_DRAINER]}D  avgHP=${avgHp}%  inTarget=${inTarget}/${members.length}`
        );

        for (const c of members) {
          const hpPct = Math.round((c.hits / c.hitsMax) * 100);
          console.log(
            `  ${c.name}  role=${c.memory.role}  room=${c.room.name}  hp=${hpPct}%  ttl=${c.ticksToLive ?? "?"}`
          );
        }
      }

      if (queue.length > 0) {
        console.log(`[Military] Offensive queue (${queue.length}):`);
        queue.forEach((q, i) => {
          console.log(
            `  ${i + 1}. ${q.targetRoom}${q.homeRoom ? ` (prefer ${q.homeRoom})` : ""}  ${q.formation}/${q.tactic}  ` +
            `${q.requiredEnforcers}E/${q.requiredTriggermen}T/${q.requiredMedics}M/${q.requiredWreckers}R/${q.requiredDecoys ?? 0}D`
          );
        });
      }
    },

    // Aliases retained for backwards compatibility.
    retreat: () => (Game as any).arca.recall(),
    military: () => (Game as any).arca.squads(),

    // One-shot overview of all multi-op pipelines: expansion, offensive, SK.
    ops: () => {
      // Expansion
      const exp = Memory.expansion;
      const expQueue = getExpansionQueue();
      console.log("[ARCA] === Operations Overview ===");
      if (exp) {
        console.log(`  Expansion ACTIVE: ${exp.roomName} (${exp.phase}) ← ${exp.homeRoom}`);
      } else {
        console.log("  Expansion: idle");
      }
      if (expQueue.length > 0) {
        console.log(`    queue (${expQueue.length}): ${expQueue.map((q) => q.roomName).join(", ")}`);
      }

      // Offensive
      const mOps = getOffensiveOps();
      const mQueue = getMilitaryQueue();
      if (mOps.length === 0) console.log("  Offensive: none active");
      for (const op of mOps) {
        console.log(`  Offensive: ${op.homeRoom} → ${op.targetRoom} (${op.phase}, ${op.tactic})`);
      }
      if (mQueue.length > 0) {
        console.log(`    queue (${mQueue.length}): ${mQueue.map((q) => q.targetRoom).join(", ")}`);
      }

      // Source Keeper
      const skOps = Memory.skOps ?? [];
      if (skOps.length === 0) console.log("  Source Keeper: none active");
      for (const op of skOps) {
        console.log(`  Source Keeper: #${op.id} ${op.homeRoom} → ${op.roomName} (${op.phase})`);
      }
    },

    // Toggle / inspect the WarCouncil auto-attack and list ranked targets.
    warcouncil: (autoAttack?: boolean) => {
      if (!Memory.warCouncil) Memory.warCouncil = { autoAttack: false };
      if (autoAttack !== undefined) {
        Memory.warCouncil.autoAttack = autoAttack;
        console.log(`[WarCouncil] Auto-attack ${autoAttack ? "ENABLED" : "DISABLED"}`);
      }
      console.log(
        `[WarCouncil] auto-attack=${Memory.warCouncil.autoAttack}  ` +
        `lastScan=${Memory.warCouncil.lastScan ?? "never"}`
      );
      const intel = Memory.intel ?? {};
      const targets = Object.values(intel)
        .filter((i) => i.owner)
        .sort((a, b) => a.threatLevel - b.threatLevel)
        .slice(0, 10);
      if (targets.length === 0) {
        console.log("[WarCouncil] No enemy rooms in intel yet — scout or use an observer.");
        return;
      }
      console.log("[WarCouncil] Known enemy rooms (lowest threat first):");
      for (const t of targets) {
        const age = Game.time - t.lastSeen;
        console.log(
          `  ${t.roomName}  threat=${t.threatLevel}  owner=${t.owner}  rcl=${t.rcl}  ` +
          `towers=${t.towers}  spawns=${t.spawns}${t.safeMode ? "  SAFEMODE" : ""}  seen=${age}t ago`
        );
      }
    },

    // Force (or lift) an exit-blockade LOCKDOWN on a room. When besieged — armed hostiles
    // camping your exits, killing every creep that leaves — this suppresses all outbound
    // roles (scouts/remotes/expansion/offense/ops) and pours energy into the home economy
    // to race for RCL3 + towers. Auto-detection also arms this, but a manual lockdown holds
    // until you clear it (useful when you have no vision of the guards).
    //   Game.arca.lockdown()             → list blockade status of all owned rooms
    //   Game.arca.lockdown('W1N1')       → force lockdown ON
    //   Game.arca.lockdown('W1N1', false)→ lift lockdown (manual + auto)
    lockdown: (roomName?: string, on = true) => {
      if (!roomName) {
        let any = false;
        for (const rn in Game.rooms) {
          const room = Game.rooms[rn];
          if (!room.controller?.my) continue;
          any = true;
          const b = room.memory.blockade;
          if (!b) {
            console.log(`[Lockdown] ${rn}: clear`);
            continue;
          }
          const kind = b.manual ? "MANUAL" : `auto (expires in ${Math.max(0, b.until - Game.time)}t)`;
          console.log(`[Lockdown] ${rn}: BLOCKADED ${kind}  guards=${b.guards ?? "?"}`);
        }
        if (!any) console.log("[Lockdown] No owned rooms");
        console.log("[Lockdown] Set with Game.arca.lockdown('W1N1')  |  lift with Game.arca.lockdown('W1N1', false)");
        return;
      }
      const room = Game.rooms[roomName];
      if (!room?.controller?.my) {
        console.log(`[Lockdown] ${roomName} is not a room you own or is not in vision`);
        return;
      }
      if (on) {
        const existing = room.memory.blockade;
        room.memory.blockade = {
          detectedAt: existing?.detectedAt ?? Game.time,
          until: Game.time, // irrelevant while manual holds it
          manual: true,
          guards: existing?.guards,
        };
        console.log(`[Lockdown] ${roomName}: LOCKED DOWN — all outbound roles suppressed until you lift it`);
      } else {
        delete room.memory.blockade;
        console.log(`[Lockdown] ${roomName}: lifted — outbound roles resume`);
      }
    },

    // Show threat status across all owned rooms
    threat: () => {
      let found = false;
      for (const rn in Game.rooms) {
        const room = Game.rooms[rn];
        if (!room.controller?.my) continue;
        found = true;
        const { hostiles, score } = getThreatInfo(room);
        const severity = getThreatSeverity(room);
        const towerIds = room.memory.towerIds ?? [];
        const towerEnergy = towerIds.reduce((sum, id) => {
          const t = Game.getObjectById(id) as StructureTower | null;
          return sum + (t?.store[RESOURCE_ENERGY] ?? 0);
        }, 0);
        const safemodeStatus = room.controller.safeMode
          ? `ACTIVE (${room.controller.safeMode} ticks)`
          : room.controller.safeModeAvailable
          ? `ready (${room.controller.safeModeAvailable} charge${room.controller.safeModeAvailable !== 1 ? "s" : ""})`
          : "unavailable";
        const blockadeStatus = isBlockaded(room)
          ? `  BLOCKADED${room.memory.blockade?.manual ? "(manual)" : ""}`
          : "";
        console.log(
          `[Threat] ${rn}: severity=${severity} score=${score} hostiles=${hostiles.length}` +
          `  towers=${towerIds.length} energy=${towerEnergy}  safemode=${safemodeStatus}${blockadeStatus}`
        );
        if (hostiles.length > 0) {
          for (const h of hostiles) {
            const parts = h.body.map((p) => p.type).join(",");
            console.log(`  ${h.name} (${h.owner.username}) hp=${h.hits}/${h.hitsMax} parts=${parts}`);
          }
        }
      }
      if (!found) console.log("[Threat] No owned rooms");
    },

    // Show inbound-nuke status and rampart reinforcement progress across owned rooms
    nukes: () => {
      let found = false;
      for (const rn in Game.rooms) {
        const room = Game.rooms[rn];
        if (!room.controller?.my) continue;
        const nukes = room.find(FIND_NUKES);
        if (nukes.length === 0) continue;
        found = true;
        const earliest = nukes.reduce((m, n) => Math.min(m, n.timeToLand), Infinity);
        console.log(`[Nuke] ${rn}: ${nukes.length} inbound — first impact in ${earliest} ticks`);
        const def = room.memory.nukeDefense;
        if (!def) continue;
        for (const key in def.tiles) {
          const required = def.tiles[key];
          const [x, y] = key.split(",").map(Number);
          const structures = room.lookForAt(LOOK_STRUCTURES, x, y);
          const rampart = structures.find(
            (s) => s.structureType === STRUCTURE_RAMPART
          ) as StructureRampart | undefined;
          const structAt = structures.find((s) => s.structureType !== STRUCTURE_RAMPART);
          const have = rampart?.hits ?? 0;
          const ok = have >= required ? "OK" : `${Math.round((have / required) * 100)}%`;
          console.log(
            `  (${x},${y}) ${structAt?.structureType ?? "?"}: ${have}/${required} [${ok}]`
          );
        }
      }
      if (!found) console.log("[Nuke] No inbound nukes detected");
    },

    // Show OFFENSIVE nuker load status per owned room (energy %, ghodium %, cooldown, ready).
    nuker: () => {
      const statuses = describeNukers();
      if (statuses.length === 0) {
        console.log("[Nuker] No nukers found (built at RCL 8)");
        return;
      }
      for (const s of statuses) {
        const ePct = Math.round((s.energy / s.energyCapacity) * 100);
        const gPct = Math.round((s.ghodium / s.ghodiumCapacity) * 100);
        const cd = s.cooldown > 0 ? `cooldown=${s.cooldown}t` : "cooldown=0";
        const state = s.ready ? "READY" : "loading";
        console.log(
          `[Nuker] ${s.room}: energy=${s.energy}/${s.energyCapacity} (${ePct}%)  ` +
          `ghodium=${s.ghodium}/${s.ghodiumCapacity} (${gPct}%)  ${cd}  [${state}]`
        );
      }
      console.log("[Nuker] Launch with: Game.arca.launchNuke('W1N1', 'W5N5', 25, 25)  or  Game.arca.launchNuke('W1N1', 'FLAG_NAME')");
    },

    // Launch a nuke from `fromRoom` at a target. Target is either an (x,y) in a room name,
    // or the name of a flag (its position is used). DESTRUCTIVE and MANUAL ONLY — never auto.
    //   Game.arca.launchNuke('W1N1', 'W5N5', 25, 25)
    //   Game.arca.launchNuke('W1N1', 'NUKE_HERE')   // target a flag by name
    launchNuke: (fromRoom: string, target: string, x?: number, y?: number) => {
      if (!fromRoom || !target) {
        console.log("[Nuker] Usage: Game.arca.launchNuke('W1N1', 'W5N5', 25, 25)  or  Game.arca.launchNuke('W1N1', 'FLAG_NAME')");
        return;
      }

      // Resolve the target position: a flag name, or (roomName, x, y).
      let pos: RoomPosition;
      const flag = Game.flags[target];
      if (flag) {
        pos = flag.pos;
      } else {
        if (x === undefined || y === undefined) {
          console.log(`[Nuker] '${target}' is not a flag — provide x and y: Game.arca.launchNuke('${fromRoom}', '${target}', 25, 25)`);
          return;
        }
        if (x < 0 || x > 49 || y < 0 || y > 49) {
          console.log(`[Nuker] Invalid coordinates (${x},${y}) — must be 0..49`);
          return;
        }
        pos = new RoomPosition(x, y, target);
      }

      const err = launchNukeFrom(fromRoom, pos);
      if (err) {
        console.log(`[Nuker] Launch ABORTED — ${err}`);
        return;
      }
      const msg =
        `[Nuker] LAUNCHED from ${fromRoom} → ${pos.roomName} (${pos.x},${pos.y}) — ` +
        `impact in ${NUKE_LAND_TIME} ticks`;
      console.log(msg);
      Game.notify(msg, 0);
    },

    // Manually activate safemode in a room
    safemode: (roomName: string) => {
      if (!roomName) {
        console.log("[SafeMode] Usage: Game.arca.safemode('W1N1')");
        return;
      }
      const room = Game.rooms[roomName];
      if (!room?.controller?.my) {
        console.log(`[SafeMode] ${roomName} is not a room you own or is not in vision`);
        return;
      }
      const ctrl = room.controller;
      if (ctrl.safeMode) {
        console.log(`[SafeMode] ${roomName} already has safemode active (${ctrl.safeMode} ticks remaining)`);
        return;
      }
      if (!ctrl.safeModeAvailable) {
        console.log(`[SafeMode] ${roomName} has no safemode charges available`);
        return;
      }
      const result = ctrl.activateSafeMode();
      if (result === OK) {
        console.log(`[SafeMode] Activated in ${roomName} manually`);
      } else {
        console.log(`[SafeMode] Failed to activate in ${roomName}: error ${result}`);
      }
    },

    // Show power bank operation status
    power: () => {
      const ops = Memory.powerOps;
      if (!ops || ops.length === 0) {
        console.log("[Power] No active power bank operations");
        return;
      }
      for (const op of ops) {
        const age = Game.time - op.startedAt;
        const members = Object.values(Game.creeps).filter((c) => c.memory.powerOpId === op.id);
        const attackers = members.filter((c) => c.memory.role === ROLE_POWER_ATTACKER).length;
        const healers = members.filter((c) => c.memory.role === ROLE_POWER_HEALER).length;
        const carriers = members.filter((c) => c.memory.role === ROLE_POWER_CARRIER).length;
        console.log(
          `[Power] Op #${op.id}: ${op.homeRoom} → ${op.roomName}` +
          `  phase=${op.phase}  power=${op.power}  age=${age}`
        );
        console.log(
          `  Squad: ${attackers}/${op.requiredAttackers}A  ${healers}/${op.requiredHealers}H  ${carriers}/${op.requiredCarriers}C`
        );
        for (const c of members) {
          const hpPct = Math.round((c.hits / c.hitsMax) * 100);
          console.log(`  ${c.name}  role=${c.memory.role}  room=${c.room.name}  hp=${hpPct}%`);
        }
      }
      // PowerSpawn status
      let foundPs = false;
      for (const rn in Game.rooms) {
        const room = Game.rooms[rn];
        if (!room.controller?.my || !room.memory.powerSpawnId) continue;
        const ps = Game.getObjectById(room.memory.powerSpawnId) as StructurePowerSpawn | null;
        if (!ps) continue;
        foundPs = true;
        console.log(
          `[Power] ${rn} PowerSpawn: power=${ps.power}  energy=${ps.store[RESOURCE_ENERGY]}`
        );
      }
      if (!foundPs) console.log("[Power] No PowerSpawn structures found (RCL 8 required)");
    },

    // Show highway deposit mining operation status
    deposits: () => {
      const ops = Memory.depositOps;
      if (!ops || ops.length === 0) {
        console.log("[Deposit] No active deposit mining operations");
        return;
      }
      for (const op of ops) {
        const age = Game.time - op.startedAt;
        const members = Object.values(Game.creeps).filter((c) => c.memory.depositOpId === op.id);
        const miners = members.filter((c) => c.memory.role === ROLE_DEPOSIT_MINER).length;
        const haulers = members.filter((c) => c.memory.role === ROLE_DEPOSIT_HAULER).length;
        console.log(
          `[Deposit] Op #${op.id}: ${op.homeRoom} → ${op.roomName}` +
          `  type=${op.depositType}  phase=${op.phase}  cooldown=${op.lastCooldown}  age=${age}`
        );
        console.log(
          `  Crew: ${miners}/${op.requiredMiners} miners  ${haulers}/${op.requiredHaulers} haulers`
        );
        for (const c of members) {
          console.log(`  ${c.name}  role=${c.memory.role}  room=${c.room.name}  load=${c.store.getUsedCapacity()}`);
        }
      }
    },

    // Source Keeper mining. No arg → status; with a room → start an op; skstop → cancel.
    sk: (roomName?: string) => {
      if (roomName) {
        const err = launchSkOp(roomName);
        if (err) console.log(`[SK] Cannot mine ${roomName} — ${err}`);
        else console.log(`[SK] Operation started against ${roomName}`);
        return;
      }
      const ops = Memory.skOps ?? [];
      if (ops.length === 0) {
        console.log("[SK] No active operations. Start one with Game.arca.sk('W5N4')");
        return;
      }
      for (const op of ops) {
        const members = getSkMembers(op.id);
        const counts: Record<string, number> = {};
        let energyHauled = 0;
        for (const c of members) {
          counts[c.memory.role] = (counts[c.memory.role] ?? 0) + 1;
          energyHauled += c.store?.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
        }
        const paused = isOpPaused(op) ? "  PAUSED(contested)" : "";
        console.log(
          `[SK] #${op.id} ${op.homeRoom} → ${op.roomName}  phase=${op.phase}  ` +
          `sources=${op.sourceIds.length}  squad=${JSON.stringify(counts)}${paused}`
        );
      }
    },

    skstop: (roomName: string) => {
      if (!roomName) {
        console.log("[SK] Usage: Game.arca.skstop('W5N4')");
        return;
      }
      if (cancelSkOp(roomName)) console.log(`[SK] Operation against ${roomName} cancelled`);
      else console.log(`[SK] No operation found for ${roomName}`);
    },

    // Toggle the traffic manager (stuck-repath + guarded shove). Kill-switch if it
    // ever misbehaves — falls back to vanilla moveTo.
    traffic: (enabled?: boolean) => {
      if (enabled === undefined) {
        console.log(`[Traffic] manager is ${Memory.trafficDisabled ? "OFF" : "ON"}`);
        return;
      }
      Memory.trafficDisabled = !enabled;
      console.log(`[Traffic] manager ${enabled ? "ENABLED" : "DISABLED"}`);
    },

    // Per-subsystem CPU breakdown (rolling average, last tick, peak), highest first.
    cpu: () => {
      const stats = getCpuStats();
      const rows = Object.entries(stats).sort((a, b) => b[1].ema - a[1].ema);
      const total = rows.reduce((sum, [, s]) => sum + s.ema, 0);
      console.log(
        `[CPU] limit=${Game.cpu.limit} bucket=${Game.cpu.bucket} avgTotal=${total.toFixed(2)}`
      );
      for (const [name, s] of rows) {
        console.log(
          `  ${name.padEnd(14)} avg=${s.ema.toFixed(2)} last=${s.last.toFixed(2)} peak=${s.peak.toFixed(2)}`
        );
      }
    },

    // Show power creep (Operator) status: level, location, ops, and known powers.
    powercreeps: () => {
      const names = Object.keys(Game.powerCreeps);
      if (names.length === 0) {
        console.log(
          `[Power] No power creeps. GPL ${Game.gpl.level} — one will be created automatically when GPL >= 1.`
        );
        return;
      }
      for (const name of names) {
        const pc = Game.powerCreeps[name];
        const loc = pc.ticksToLive === undefined
          ? pc.spawnCooldownTime && Game.time < pc.spawnCooldownTime
            ? `unspawned (cooldown ${pc.spawnCooldownTime - Game.time}t)`
            : "unspawned (ready)"
          : `${pc.room?.name ?? "?"}  ttl=${pc.ticksToLive}`;
        const ops = pc.store?.getUsedCapacity(RESOURCE_OPS) ?? 0;
        const powers = Object.keys(pc.powers)
          .map((p) => `${p}:L${pc.powers[Number(p) as PowerConstant].level}`)
          .join(" ");
        console.log(`[Power] ${name}  L${pc.level}  ${loc}  ops=${ops}  powers=[${powers}]`);
      }
      console.log(`[Power] GPL ${Game.gpl.level} (${Game.gpl.progress}/${Game.gpl.progressTotal})`);
    },

    // Enable or disable auto-production for a room's lab system
    autoLabs: (roomName: string, enabled: boolean) => {
      const room = Game.rooms[roomName];
      if (!room?.controller?.my) {
        console.log(`[Labs] ${roomName} is not a room you own`);
        return;
      }
      if (!room.memory.labSystem) room.memory.labSystem = { queue: [] };
      room.memory.labSystem.autoEnabled = enabled;
      console.log(`[Labs] ${roomName}: Auto-production ${enabled ? "ENABLED" : "DISABLED"}`);
    },

    // Show factory / commodity production status for all owned rooms with a factory.
    factory: () => {
      const lines = describeFactories();
      if (lines.length === 0) {
        console.log("[Factory] No factories found (need RCL 7+ and a built factory)");
        return;
      }
      for (const line of lines) console.log(line);
    },

    // Force a room's factory to produce a specific commodity until the next auto-plan.
    //   Game.arca.produceCommodity('W1N1', 'battery')
    produceCommodity: (roomName: string, commodity: string) => {
      if (!roomName || !commodity) {
        console.log("[Factory] Usage: Game.arca.produceCommodity('W1N1', 'battery')");
        return;
      }
      const err = forceCommodity(roomName, commodity);
      if (err) {
        console.log(`[Factory] ${err}`);
        return;
      }
      console.log(`[Factory] ${roomName}: now producing ${commodity}`);
    },

    // Enable or disable auto-production for a room's factory.
    autoFactory: (roomName: string, enabled: boolean) => {
      if (!roomName || enabled === undefined) {
        console.log("[Factory] Usage: Game.arca.autoFactory('W1N1', true)");
        return;
      }
      const err = setFactoryAuto(roomName, enabled);
      if (err) {
        console.log(`[Factory] ${err}`);
        return;
      }
      console.log(`[Factory] ${roomName}: Auto-production ${enabled ? "ENABLED" : "DISABLED"}`);
    },
  };
}
