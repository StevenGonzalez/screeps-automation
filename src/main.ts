import * as creepRunnerSystem from "./systems/creeps";
import * as memorySystem from "./systems/memory";
import * as pixelsSystem from "./systems/pixels";
import * as spawningSystem from "./systems/spawning";

export function loop() {
  creepRunnerSystem.loop();
  memorySystem.loop();
  pixelsSystem.loop();
  spawningSystem.loop();
}
