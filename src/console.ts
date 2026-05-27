import { resolveChain, getStockForCompound } from "./services/services.labs";

const EXPANSION_CANDIDATE_SOURCES_WEIGHT = 40;
const EXPANSION_CANDIDATE_DIST_PENALTY = 5;

export function setupConsole() {
  (Game as any).arca = {
    // Show ranked expansion candidates from ranger scout data
    expand: () => {
      type Candidate = { room: string; homeRoom: string; score: number; sources: number; dist: number };
      const candidates: Candidate[] = [];

      for (const rn in Game.rooms) {
        const room = Game.rooms[rn];
        if (!room.controller?.my) continue;
        for (const remote of room.memory.remoteRooms ?? []) {
          if (remote.hostile) continue;
          const targetRoom = Game.rooms[remote.roomName];
          if (targetRoom?.controller?.my) continue; // already ours
          if (targetRoom?.controller?.owner) continue; // someone else's
          const dist = Game.map.getRoomLinearDistance(rn, remote.roomName);
          const score =
            remote.sources.length * EXPANSION_CANDIDATE_SOURCES_WEIGHT -
            dist * EXPANSION_CANDIDATE_DIST_PENALTY;
          candidates.push({
            room: remote.roomName,
            homeRoom: rn,
            score,
            sources: remote.sources.length,
            dist,
          });
        }
      }

      if (candidates.length === 0) {
        console.log("[ARCA] No expansion candidates in scout data — send rangers first");
        return;
      }

      candidates.sort((a, b) => b.score - a.score);
      console.log("[ARCA] Top expansion candidates:");
      for (const c of candidates.slice(0, 5)) {
        console.log(
          `  ${c.room}  score=${c.score}  sources=${c.sources}  dist=${c.dist}  fundedBy=${c.homeRoom}`
        );
      }
      console.log("[ARCA] Claim with: Game.arca.claim('ROOM_NAME')");
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

    // Show current expansion status
    status: () => {
      const e = Memory.expansion;
      if (!e) {
        console.log("[ARCA] No active expansion");
        return;
      }
      const age = Game.time - e.startedAt;
      console.log(
        `[ARCA] ${e.roomName} | Phase: ${e.phase} | Home: ${e.homeRoom} | Age: ${age} ticks`
      );
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
  };
}
