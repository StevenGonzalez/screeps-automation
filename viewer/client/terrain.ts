// Room terrain, fetched once through the viewer's server and painted in a
// worker: a small picture of every room for the realm map, and a large one
// for rooms the camera comes close to. Both are painted for the season, and
// painted again when it turns, the old pictures shown until the new are ready.

import type { TownSeason } from "../../src/config/config.town";
import { roomCoords, splitKey } from "../shared/realm";
import type { BakeRequest } from "./terrain.worker";

const THUMB_PX = 4;
const DETAIL_PX = 32;
const DETAIL_KEPT = 10;
const RETRY_MS = 60_000;

type Kind = "thumb" | "detail";

interface Painted {
  bitmap: ImageBitmap;
  season: TownSeason;
}

export class Terrain {
  private readonly raw = new Map<string, string>();
  private readonly failedAt = new Map<string, number>();
  private readonly fetching = new Set<string>();
  private readonly thumbs = new Map<string, Painted>();
  private readonly details = new Map<string, Painted>();
  private readonly baking = new Map<number, { key: string; kind: Kind; season: TownSeason }>();
  private readonly queued = new Set<string>();
  private nextId = 1;
  // Nothing is painted until the season is known, so the land is not painted twice.
  private season: TownSeason | null = null;
  // The small pictures take moments and the large about a second each, so
  // each kind has its own worker and the realm map never waits on a close-up.
  private readonly workers: Record<Kind, Worker> = {
    thumb: new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" }),
    detail: new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" }),
  };

  constructor() {
    const done = async (ev: MessageEvent<{ id: number; size: number; pixels: Uint8ClampedArray<ArrayBuffer> }>) => {
      const job = this.baking.get(ev.data.id);
      if (!job) return;
      this.baking.delete(ev.data.id);
      this.queued.delete(`${job.kind}:${job.season}:${job.key}`);
      // Painted for a season that has since turned.
      if (job.season !== this.season) return;
      const bitmap = await createImageBitmap(new ImageData(ev.data.pixels, ev.data.size, ev.data.size));
      const kept = job.kind === "thumb" ? this.thumbs : this.details;
      kept.get(job.key)?.bitmap.close();
      kept.delete(job.key);
      kept.set(job.key, { bitmap, season: job.season });
      while (this.details.size > DETAIL_KEPT) {
        const oldest = this.details.keys().next().value!;
        this.details.get(oldest)?.bitmap.close();
        this.details.delete(oldest);
      }
    };
    this.workers.thumb.onmessage = done;
    this.workers.detail.onmessage = done;
  }

  /** The room's terrain as 2500 digits, once fetched. */
  terrain(key: string): string | undefined {
    const t = this.raw.get(key);
    if (!t) this.fetch(key);
    return t;
  }

  /** Sets the season the land is painted in. */
  setSeason(season: TownSeason): void {
    this.season = season;
  }

  thumb(key: string): ImageBitmap | undefined {
    const p = this.thumbs.get(key);
    if (!p || p.season !== this.season) this.bake(key, "thumb");
    return p?.bitmap;
  }

  detail(key: string): ImageBitmap | undefined {
    const p = this.details.get(key);
    if (!p || p.season !== this.season) this.bake(key, "detail");
    if (p) {
      // Most recently used last, so the oldest goes first.
      this.details.delete(key);
      this.details.set(key, p);
    }
    return p?.bitmap;
  }

  private bake(key: string, kind: Kind): void {
    const season = this.season;
    if (!season) return;
    const tag = `${kind}:${season}:${key}`;
    if (this.queued.has(tag)) return;
    const terrain = this.terrain(key);
    const at = roomCoords(splitKey(key).room);
    if (!terrain || !at) return;
    this.queued.add(tag);
    const id = this.nextId++;
    this.baking.set(id, { key, kind, season });
    const px = kind === "thumb" ? THUMB_PX : DETAIL_PX;
    const req: BakeRequest = { id, terrain, px, ox: at.x * 50, oy: at.y * 50, season };
    this.workers[kind].postMessage(req);
  }

  private fetch(key: string): void {
    if (this.fetching.has(key)) return;
    const failed = this.failedAt.get(key);
    if (failed !== undefined && performance.now() - failed < RETRY_MS) return;
    this.fetching.add(key);
    fetch(`/realm/terrain?key=${encodeURIComponent(key)}`)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((t) => {
        if (t.length === 2500) this.raw.set(key, t);
        else this.failedAt.set(key, performance.now());
      })
      .catch(() => this.failedAt.set(key, performance.now()))
      .finally(() => this.fetching.delete(key));
  }
}
