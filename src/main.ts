import * as creepRunnerSystem from "./orchestrators/orchestrator.creep";
import * as labsSystem from "./orchestrators/orchestrator.labs";
import * as factorySystem from "./orchestrators/orchestrator.factory";
import * as linksSystem from "./orchestrators/orchestrator.links";
import * as memorySystem from "./orchestrators/orchestrator.memory";
import * as strategySystem from "./orchestrators/orchestrator.strategy";
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
import { runAllies } from "./services/services.allies";
import { setupConsole } from "./console";
import { recordCpu } from "./services/services.profiler";
// Side-effect import: installs the traffic-managed moveTo override on Creep.prototype.
import "./services/services.movement";

const CPU_WARN_THRESHOLD = 0.85;

// Skip expensive-but-non-critical systems when the tick is already loaded.
// Structures planning runs heavy pathfinding; visuals are cosmetic.
// Using fractions of cpu.limit keeps thresholds portable across account tiers.
const CPU_SKIP_STRUCTURES_THRESHOLD = 0.70; // skip structure planner above 70% of limit
const CPU_SKIP_VISUALS_THRESHOLD = 0.75;    // skip visuals above 75% of limit
// Heavy, non-time-critical systems (factory/labs/nuker/observer/pixels). They already
// tolerate being skipped occasionally — labs/factory re-evaluate next tick, the nuker
// loads over many ticks, the observer scans on a rotating queue, pixels only mint at a
// full bucket. Shedding them above 80% of limit (or when the bucket is critical) frees
// CPU for the survival/economy systems that MUST run every tick (memory, strategy,
// creeps, spawning, towers, military, terminal) without degrading those heavy systems.
const CPU_SKIP_HEAVY_THRESHOLD = 0.80;      // skip heavy non-critical systems above 80% of limit

// When the bucket is drained the game is about to throttle us — shed load aggressively.
const CPU_BUCKET_CRITICAL = 2000;

export function loop() {
  setupConsole();
  const tickStart = Game.cpu.getUsed();
  const limit = Game.cpu.limit;
  const bucketCritical =
    typeof Game.cpu.bucket === "number" && Game.cpu.bucket < CPU_BUCKET_CRITICAL;
  const cpuFraction = (used: number): number => (limit ? used / limit : 0);
  // True when this tick is already loaded enough that a heavy, skip-tolerant system
  // should be shed. Re-evaluated at each heavy system's call site (CPU climbs through
  // the tick), so an early-tick spike sheds the later heavy systems but a cheap tick
  // runs them all.
  const heavyShed = (): boolean =>
    bucketCritical || cpuFraction(Game.cpu.getUsed() - tickStart) >= CPU_SKIP_HEAVY_THRESHOLD;

  runSafe("memory", () => memorySystem.loop());
  // Set empire-wide posture immediately after memory cleanup so the systems below
  // (expansion, military, spawning, towers) all read a fresh posture this same tick.
  runSafe("strategy", () => strategySystem.loop());
  // Refresh ally identity and exchange ally requests before any combat/targeting code
  // (towers, military) reads threat info — so friends are never treated as hostiles.
  runSafe("allies", () => runAllies());
  runSafe("expansion", () => expansionSystem.loop());
  runSafe("creeps", () => creepRunnerSystem.loop());
  runSafe("spawning", () => spawningSystem.loop());

  // Structure planning includes pathfinding — skip when CPU is already consumed
  // or the bucket is critically low.
  const cpuAfterCore = Game.cpu.getUsed() - tickStart;
  if (!bucketCritical && cpuFraction(cpuAfterCore) < CPU_SKIP_STRUCTURES_THRESHOLD) {
    runSafe("structures", () => structuresSystem.loop());
  }

  // Labs/factory are heavy and skip-tolerant — shed them under load. Factory still runs
  // after creeps (so it can override an idle hauler as a courier) and after labs, before
  // terminal — it produces commodities the terminal may later vend.
  if (!heavyShed()) runSafe("labs", () => labsSystem.loop());
  if (!heavyShed()) runSafe("factory", () => factorySystem.loop());
  runSafe("links", () => linksSystem.loop());
  runSafe("towers", () => towerSystem.loop());
  runSafe("terminal", () => terminalSystem.loop());
  runSafe("military", () => militarySystem.loop());
  runSafe("nukes", () => nukeSystem.loop());
  // Offensive nuker loading. Runs after creeps (so its borrowed-hauler intents win) and
  // after terminal (so newly transferred-in ghodium is available to load this tick).
  // Heavy/skip-tolerant — it loads ghodium over many ticks, so missing one is harmless.
  if (!heavyShed()) runSafe("nuker", () => nukerSystem.loop());
  runSafe("sourcekeeper", () => sourceKeeperSystem.loop());
  runSafe("powercreep", () => powerCreepSystem.loop());
  // Observer (rotating scan queue) and pixels (only mint at a full bucket) both tolerate
  // being skipped under load.
  if (!heavyShed()) runSafe("observer", () => observerSystem.loop());
  if (!heavyShed()) runSafe("pixels", () => pixelsSystem.loop());

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
  const start = Game.cpu.getUsed();
  try {
    fn();
  } catch (e: unknown) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
    console.log(`[ERROR] System "${name}" threw: ${msg}`);
  } finally {
    recordCpu(name, Game.cpu.getUsed() - start);
  }
}
