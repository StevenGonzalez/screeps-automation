import * as creepRunnerSystem from "./orchestrators/orchestrator.creep";
import * as memorySystem from "./orchestrators/orchestrator.memory";
import * as pixelsSystem from "./orchestrators/orchestrator.pixels";
import * as spawningSystem from "./orchestrators/orchestrator.spawning";
import * as structuresSystem from "./orchestrators/orchestrator.structures";
import * as towerSystem from "./orchestrators/orchestrator.tower";

export function loop() {
  creepRunnerSystem.loop();
  memorySystem.loop();
  pixelsSystem.loop();
  spawningSystem.loop();
  structuresSystem.loop();
  towerSystem.loop();
}
