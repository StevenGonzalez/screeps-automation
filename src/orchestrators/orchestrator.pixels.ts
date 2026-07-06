declare global {
  interface Memory {
    pixelGeneration?: boolean;
  }
}

export function loop() {
  processPixelGeneration();
}

function processPixelGeneration() {
  if (typeof Game.cpu.generatePixel !== "function") return;
  if (Memory.pixelGeneration === false) return;
  if (Game.cpu.bucket >= 10000) {
    Game.cpu.generatePixel();
  }
}
