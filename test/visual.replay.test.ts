import { describe, it, expect, beforeEach } from "vitest";
import { drawAndKeep, replayKept } from "../src/services/services.visualreplay";

const g = globalThis as Record<string, unknown>;

// Visuals as the server keeps them: export gives null until something is drawn,
// then every line drawn this tick; import appends what it is given.
class FakeVisual {
  data: string | null = null;
  export(): string {
    return this.data as string;
  }
  import(text: string): this {
    this.data = (this.data ?? "") + text;
    return this;
  }
  draw(line: string): void {
    this.import(`${line}\n`);
  }
}

let room: { visual: FakeVisual };
let map: FakeVisual;

function newTick(time: number): void {
  room = { visual: new FakeVisual() };
  map = new FakeVisual();
  g.Game = { time, rooms: { W1N1: room }, map: { visual: map } };
}

describe("visual replay", () => {
  beforeEach(() => newTick(100));

  it("lays the last drawing down again on a tick the visuals are shed", () => {
    // A creep's path line drawn before the visuals ran is not part of the HUD.
    room.visual.draw("path");
    drawAndKeep(() => {
      room.visual.draw("hud");
      map.draw("realm");
    });

    newTick(101);
    room.visual.draw("path2");
    replayKept();
    expect(room.visual.export()).toBe("path2\nhud\n");
    expect(map.export()).toBe("realm\n");
  });

  it("leaves the screen bare once the drawing is too old", () => {
    drawAndKeep(() => room.visual.draw("hud"));
    newTick(100 + 31);
    replayKept();
    expect(room.visual.export()).toBeNull();
  });
});
