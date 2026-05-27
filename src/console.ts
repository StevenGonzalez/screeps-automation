export function setupConsole() {
  (Game as any).arca = {
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
      const homeRoom = Object.values(Game.rooms).find((r) => r.controller?.my)?.name;
      if (!homeRoom) {
        console.log("[ARCA] No owned room found to fund the expansion");
        return;
      }
      Memory.expansion = {
        roomName,
        homeRoom,
        phase: "claiming",
        startedAt: Game.time,
      };
      console.log(`[ARCA] Expansion to ${roomName} queued (funded by ${homeRoom})`);
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
        `[ARCA] Expanding to ${e.roomName} | Phase: ${e.phase} | Home: ${e.homeRoom} | Age: ${age} ticks`
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
