import * as creepRunnerSystem from "./orchestrators/orchestrator.creep";
import * as labsSystem from "./orchestrators/orchestrator.labs";
import * as factorySystem from "./orchestrators/orchestrator.factory";
import * as linksSystem from "./orchestrators/orchestrator.links";
import * as memorySystem from "./orchestrators/orchestrator.memory";
import * as expansionSystem from "./orchestrators/orchestrator.expansion";
import * as pixelsSystem from "./orchestrators/orchestrator.pixels";
import * as spawningSystem from "./orchestrators/orchestrator.spawning";
import * as structuresSystem from "./orchestrators/orchestrator.structures";
import * as towerSystem from "./orchestrators/orchestrator.tower";
import * as terminalSystem from "./orchestrators/orchestrator.terminal";
import * as militarySystem from "./orchestrators/orchestrator.military";
import * as nukeSystem from "./orchestrators/orchestrator.nukes";
import * as nukerSystem from "./orchestrators/orchestrator.nuker";
import * as sourceKeeperSystem from "./orchestrators/orchestrator.sourcekeeper";
import * as powerCreepSystem from "./orchestrators/orchestrator.powercreep";
import * as observerSystem from "./orchestrators/orchestrator.observer";
import * as visualsSystem from "./orchestrators/orchestrator.visuals";
import { setupConsole } from "./console";
// Side-effect import: installs the traffic-managed moveTo override on Creep.prototype.
import "./services/services.movement";

const CPU_WARN_THRESHOLD = 0.85;

// Skip expensive-but-non-critical systems when the tick is already loaded.
// Structures planning runs heavy pathfinding; visuals are cosmetic.
// Using fractions of cpu.limit keeps thresholds portable across account tiers.
const CPU_SKIP_STRUCTURES_THRESHOLD = 0.70; // skip structure planner above 70% of limit
const CPU_SKIP_VISUALS_THRESHOLD = 0.60;    // skip visuals above 60% of limit

// When the bucket is drained the game is about to throttle us — shed load aggressively.
const CPU_BUCKET_CRITICAL = 2000;

export function loop() {
  setupConsole();
  const tickStart = Game.cpu.getUsed();
  const limit = Game.cpu.limit;
  const bucketCritical =
    typeof Game.cpu.bucket === "number" && Game.cpu.bucket < CPU_BUCKET_CRITICAL;
  const cpuFraction = (used: number): number => (limit ? used / limit : 0);

  runSafe("memory", () => memorySystem.loop());
  runSafe("expansion", () => expansionSystem.loop());
  runSafe("creeps", () => creepRunnerSystem.loop());
  runSafe("spawning", () => spawningSystem.loop());

  // Structure planning includes pathfinding — skip when CPU is already consumed
  // or the bucket is critically low.
  const cpuAfterCore = Game.cpu.getUsed() - tickStart;
  if (!bucketCritical && cpuFraction(cpuAfterCore) < CPU_SKIP_STRUCTURES_THRESHOLD) {
    runSafe("structures", () => structuresSystem.loop());
  }

  runSafe("labs", () => labsSystem.loop());
  // Factory runs after creeps (so it can override an idle hauler as a courier) and after
  // labs, before terminal — it produces commodities the terminal may later vend.
  runSafe("factory", () => factorySystem.loop());
  runSafe("links", () => linksSystem.loop());
  runSafe("towers", () => towerSystem.loop());
  runSafe("terminal", () => terminalSystem.loop());
  runSafe("military", () => militarySystem.loop());
  runSafe("nukes", () => nukeSystem.loop());
  // Offensive nuker loading. Runs after creeps (so its borrowed-hauler intents win) and
  // after terminal (so newly transferred-in ghodium is available to load this tick).
  runSafe("nuker", () => nukerSystem.loop());
  runSafe("sourcekeeper", () => sourceKeeperSystem.loop());
  runSafe("powercreep", () => powerCreepSystem.loop());
  runSafe("observer", () => observerSystem.loop());
  runSafe("pixels", () => pixelsSystem.loop());

  // Visuals are purely cosmetic — first thing to drop under load.
  const cpuBeforeVisuals = Game.cpu.getUsed() - tickStart;
  if (!bucketCritical && cpuFraction(cpuBeforeVisuals) < CPU_SKIP_VISUALS_THRESHOLD) {
    runSafe("visuals", () => visualsSystem.loop());
  }

  const used = Game.cpu.getUsed() - tickStart;

  if (limit && used / limit > CPU_WARN_THRESHOLD) {
    console.log(
      `[CPU] High usage: ${used.toFixed(1)}/${limit} (${((used / limit) * 100).toFixed(0)}%) bucket=${Game.cpu.bucket}`
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
