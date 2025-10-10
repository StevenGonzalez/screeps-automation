export function loop() {
  processPixelGeneration();
}

function processPixelGeneration() {
  if (Game.cpu.bucket === 10000) {
    Game.cpu.generatePixel();
  }
}
