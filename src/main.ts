import * as creepRunnerSystem from "./orchestrators/creep";
import * as memorySystem from "./orchestrators/memory";
import * as pixelsSystem from "./orchestrators/pixels";
import * as spawningSystem from "./orchestrators/spawning";

export function loop() {
  creepRunnerSystem.loop();
  memorySystem.loop();
  pixelsSystem.loop();
  spawningSystem.loop();
}
