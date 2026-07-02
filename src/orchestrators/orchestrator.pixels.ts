// Opt-out toggle for pixel minting, owned entirely by this orchestrator (so it lives
// here rather than in types.d.ts). Default ON: pixels mint whenever the bucket is full
// unless someone explicitly sets Memory.pixelGeneration = false to hold the bucket for
// an expensive op (e.g. a big pathfinding/expansion burst).
declare global {
  interface Memory {
    pixelGeneration?: boolean;
  }
}

export function loop() {
  processPixelGeneration();
}

function processPixelGeneration() {
  // Not available on all servers (e.g. Season) — no-op there instead of throwing every tick.
  if (typeof Game.cpu.generatePixel !== "function") return;
  // Controllable: skip when explicitly disabled. The bucket>=10000 floor is unchanged —
  // generatePixel costs 10000 bucket, so this only ever fires from a full bucket anyway.
  if (Memory.pixelGeneration === false) return;
  if (Game.cpu.bucket >= 10000) {
    Game.cpu.generatePixel();
  }
}
