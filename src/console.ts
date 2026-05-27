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
  };
}
