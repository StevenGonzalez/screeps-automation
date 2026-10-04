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
import * as exchequer from "./services/services.exchequer";
import { migrateRoleNames } from "./services/services.rebrand";
import { setupConsole } from "./console";
import { recordCpu } from "./services/services.profiler";
import { drawAndKeep, replayKept } from "./services/services.visualreplay";
import "./services/services.movement";

const CPU_WARN_THRESHOLD = 0.85;

const CPU_SKIP_VISUALS_THRESHOLD = 0.75;
const CPU_SKIP_HEAVY_THRESHOLD = 0.80;

const CPU_BUCKET_CRITICAL = 2000;
// Below this the tick has almost no headroom past the limit, so heavy systems
// shed even during a pixel refill.
const CPU_BUCKET_FLOOR = 500;

// CPU the previous tick used, to tell a self-inflicted pixel drain (use under
// the limit, bucket refilling) from a real overrun.
let lastTickUsed = 0;

export function loop() {
  setupConsole();
  const tickStart = Game.cpu.getUsed();
  const limit = Game.cpu.limit;
  const bucketCritical =
    typeof Game.cpu.bucket === "number" &&
    (Game.cpu.bucket < CPU_BUCKET_FLOOR ||
      (Game.cpu.bucket < CPU_BUCKET_CRITICAL &&
        !(pixelsSystem.inPixelRefill() && lastTickUsed <= limit)));
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

  // Structures does its work on fixed ticks (construction every 5th, planning
  // every 50, remotes every 100) and next to nothing in between, so only a
  // critical bucket holds it back. Shedding it whenever the tick so far passed
  // 70% of the limit starved it: the creeps alone use about that much, and all
  // three keeps went 200 ticks without planning or placing a site.
  if (!bucketCritical) runSafe("structures", () => structuresSystem.loop());

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
  if (!heavyShed()) runSafe("exchequer", () => exchequer.loop());
  if (!heavyShed()) runSafe("pixels", () => pixelsSystem.loop());

  const cpuBeforeVisuals = Game.cpu.getUsed() - tickStart;
  if (!bucketCritical && cpuFraction(cpuBeforeVisuals) < CPU_SKIP_VISUALS_THRESHOLD) {
    runSafe("visuals", () => drawAndKeep(() => visualsSystem.loop()));
  } else {
    runSafe("visual replay", () => replayKept());
  }

  const used = Game.cpu.getUsed() - tickStart;
  lastTickUsed = Game.cpu.getUsed();

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
