import * as creepRunnerSystem from "./orchestrators/orchestrator.creep";
import * as linksSystem from "./orchestrators/orchestrator.links";
import * as memorySystem from "./orchestrators/orchestrator.memory";
import * as pixelsSystem from "./orchestrators/orchestrator.pixels";
import * as spawningSystem from "./orchestrators/orchestrator.spawning";
import * as structuresSystem from "./orchestrators/orchestrator.structures";
import * as towerSystem from "./orchestrators/orchestrator.tower";
import * as terminalSystem from "./orchestrators/orchestrator.terminal";
import * as visualsSystem from "./orchestrators/orchestrator.visuals";

const CPU_WARN_THRESHOLD = 0.85;
const CPU_REPORT_INTERVAL = 100;

export function loop() {
  const tickStart = Game.cpu.getUsed();

  runSafe("memory", () => memorySystem.loop());
  runSafe("creeps", () => creepRunnerSystem.loop());
  runSafe("spawning", () => spawningSystem.loop());
  runSafe("structures", () => structuresSystem.loop());
  runSafe("links", () => linksSystem.loop());
  runSafe("towers", () => towerSystem.loop());
  runSafe("terminal", () => terminalSystem.loop());
  runSafe("pixels", () => pixelsSystem.loop());
  runSafe("visuals", () => visualsSystem.loop());

  const used = Game.cpu.getUsed() - tickStart;
  const limit = Game.cpu.limit;

  if (used / limit > CPU_WARN_THRESHOLD) {
    console.log(
      `[CPU] High usage: ${used.toFixed(1)}/${limit} (${((used / limit) * 100).toFixed(0)}%) bucket=${Game.cpu.bucket}`
    );
  }

  if (Game.time % CPU_REPORT_INTERVAL === 0) {
    console.log(
      `[CPU] tick=${Game.time} used=${used.toFixed(1)} limit=${limit} bucket=${Game.cpu.bucket} creeps=${Object.keys(Game.creeps).length}`
    );
  }
}

function runSafe(name: string, fn: () => void): void {
  try {
    fn();
  } catch (e: unknown) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
    console.log(`[ERROR] System "${name}" threw: ${msg}`);
  }
}
