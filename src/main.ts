import * as creepRunnerSystem from "./orchestrators/orchestrator.creep";
import * as labsSystem from "./orchestrators/orchestrator.labs";
import * as factorySystem from "./orchestrators/orchestrator.factory";
import * as linksSystem from "./orchestrators/orchestrator.links";
import * as memorySystem from "./orchestrators/orchestrator.memory";
import * as strategySystem from "./orchestrators/orchestrator.strategy";
import * as expansionSystem from "./orchestrators/orchestrator.expansion";
import * as pixelsSystem from "./orchestrators/orchestrator.pixels";
import * as spawningSystem from "./orchestrators/orchestrator.spawning";
import * as scoreSystem from "./orchestrators/orchestrator.score";
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
import { migrateRoleNames } from "./services/services.rebrand";
import { setupConsole } from "./console";
import { recordCpu } from "./services/services.profiler";
import "./services/services.movement";

const CPU_WARN_THRESHOLD = 0.85;

const CPU_SKIP_STRUCTURES_THRESHOLD = 0.70;
const CPU_SKIP_VISUALS_THRESHOLD = 0.75;
const CPU_SKIP_HEAVY_THRESHOLD = 0.80;

const CPU_BUCKET_CRITICAL = 2000;

export function loop() {
  setupConsole();
  const tickStart = Game.cpu.getUsed();
  const limit = Game.cpu.limit;
  const bucketCritical =
    typeof Game.cpu.bucket === "number" && Game.cpu.bucket < CPU_BUCKET_CRITICAL;
  const cpuFraction = (used: number): number => (limit ? used / limit : 0);
  const heavyShed = (): boolean =>
    bucketCritical || cpuFraction(Game.cpu.getUsed() - tickStart) >= CPU_SKIP_HEAVY_THRESHOLD;

  runSafe("memory", () => memorySystem.loop());
  runSafe("rebrand", () => migrateRoleNames());
  runSafe("strategy", () => strategySystem.loop());
  runSafe("allies", () => runAllies());
  runSafe("expansion", () => expansionSystem.loop());
  runSafe("score", () => scoreSystem.loop());
  runSafe("creeps", () => creepRunnerSystem.loop());
  runSafe("spawning", () => spawningSystem.loop());

  const cpuAfterCore = Game.cpu.getUsed() - tickStart;
  if (!bucketCritical && cpuFraction(cpuAfterCore) < CPU_SKIP_STRUCTURES_THRESHOLD) {
    runSafe("structures", () => structuresSystem.loop());
  }

  if (!heavyShed()) runSafe("labs", () => labsSystem.loop());
  if (!heavyShed()) runSafe("factory", () => factorySystem.loop());
  runSafe("links", () => linksSystem.loop());
  runSafe("towers", () => towerSystem.loop());
  runSafe("terminal", () => terminalSystem.loop());
  runSafe("military", () => militarySystem.loop());
  runSafe("nukes", () => nukeSystem.loop());
  if (!heavyShed()) runSafe("nuker", () => nukerSystem.loop());
  runSafe("sourcekeeper", () => sourceKeeperSystem.loop());
  runSafe("powercreep", () => powerCreepSystem.loop());
  if (!heavyShed()) runSafe("observer", () => observerSystem.loop());
  if (!heavyShed()) runSafe("pixels", () => pixelsSystem.loop());

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
