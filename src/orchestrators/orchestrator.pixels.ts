import { getThreatInfo } from "../services/services.combat";
import { tally } from "../services/services.chronicle";

// Pixels distilled within this long of the last one share a chronicle line.
const PIXEL_TALLY_WINDOW = 5000;

declare global {
  interface Memory {
    pixelGeneration?: boolean;
    lastPixelTick?: number;
    pixelRefillPeak?: number;
  }
}

// Generating a pixel spends the whole 10000 bucket. For this many ticks after
// one, a low bucket is our own doing and refilling, not a CPU emergency.
export const PIXEL_REFILL_WINDOW = 5000;
// A refill is still "ours" only while the bucket keeps climbing. A drop this far
// below the best level seen since the pixel means real CPU overrun, so the
// normal bucket safeguards take over again.
const PIXEL_REFILL_SLACK = 200;

export function loop() {
  processPixelGeneration();
}

function processPixelGeneration() {
  if (typeof Game.cpu.generatePixel !== "function") return;
  if (Memory.pixelGeneration === false) return;
  if (Game.cpu.bucket < 10000) return;
  const posture = Memory.empire?.posture;
  if (posture === "WAR" || posture === "TURTLE") return;
  for (const name in Game.rooms) {
    const room = Game.rooms[name];
    if (room.controller?.my && getThreatInfo(room).hostiles.length > 0) return;
  }
  if (Game.cpu.generatePixel() === OK) {
    Memory.lastPixelTick = Game.time;
    Memory.pixelRefillPeak = 0;
    tally("pixels", 1, (n) => `The alchemists distilled ${n === 1 ? "a pixel" : `${n} pixels`} from the realm's idle thought.`, PIXEL_TALLY_WINDOW);
  }
}

/**
 * True while the bucket is refilling after a pixel we generated ourselves:
 * inside the refill window and still climbing, which means CPU use is below
 * the limit and the bucket will recover on its own. Any real fall ends the
 * refill for good.
 */
export function inPixelRefill(): boolean {
  const last = Memory.lastPixelTick;
  if (last === undefined) return false;
  const elapsed = Game.time - last;
  if (elapsed < 0 || elapsed > PIXEL_REFILL_WINDOW) return false;
  const bucket = Game.cpu.bucket;
  const peak = Math.max(Memory.pixelRefillPeak ?? 0, bucket);
  if (bucket < peak - PIXEL_REFILL_SLACK) {
    delete Memory.lastPixelTick;
    delete Memory.pixelRefillPeak;
    return false;
  }
  Memory.pixelRefillPeak = peak;
  return true;
}
