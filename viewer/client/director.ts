// The director: chooses what the camera films and how it moves between shots.
//
// At peace it tours the castles: an establishing shot of each as the camera
// arrives, then closer shots of whoever is doing something worth watching,
// for as long as there is something new to watch, now and then a pull back to
// the realm map, then a flight to the next castle. A close shot lasts as long
// as its subject keeps at what it was chosen for. It breaks off for raiders at
// any castle's gates, a new castle won, and the omens in the town's sky: the
// dragon, the wolves, a falling star.
//
// Only the room on screen (and the next, just before the camera leaves) is
// streamed in full, since the server streams two rooms per user at a time;
// `focus` says which.

import { INVADER } from "../shared/realm";
import type { Castle } from "../shared/protocol";
import type { Cinema } from "./cinema";
import { clamp, easeInOutCubic, easeInOutSine, fitScale, lerp, roomOrigin, type View } from "./camera";
import { realmLayout } from "./draw-realm";
import { creepPosition, type LiveRoom, type Store, type StoreEvent } from "./store";

export interface Geometry {
  w: number;
  h: number;
  bar: number;
}

type ShotKind = "establish" | "detail" | "follow" | "realm" | "raid" | "dragon" | "omen";

interface Shot {
  kind: ShotKind;
  // The room filmed, or null for the realm map.
  key: string | null;
  shard: string;
  start: number;
  dur: number;
  frame: (now: number) => View;
  // A creep the camera keeps with.
  follow?: string;
  // The creep the shot is about.
  subject?: string;
  // Whether the subject is done with what it was chosen for, so the shot may
  // end before its time.
  done?: (now: number) => boolean;
}

interface Move {
  kind: "cut" | "glide" | "travel";
  start: number;
  dur: number;
  from: View;
  // The widest the camera pulls back on a flight.
  peak: number;
}

interface Pick {
  id?: string;
  x: number;
  y: number;
  follow: boolean;
  name?: string;
  detail?: string;
  // What sort of thing the subject is doing, so the same sort is not filmed over and over.
  kind: string;
  weight: number;
  // A creep, for which the cinema shows a dossier.
  creep: boolean;
}

// The most shots in a castle before moving on, the first being its
// establishing shot. It moves on sooner when nothing there is worth a closer
// look: when nothing new weighs at least MIN_INTEREST.
const SHOTS_PER_VISIT = 5;
const MIN_INTEREST = 3;
const ESTABLISH_MS = 9_000;
const DETAIL_MS = 8_000;
const FOLLOW_MS = 14_000;
// A close shot runs at least this long, however soon its subject is done.
const MIN_SHOT_MS = 5_000;
// How many of the last shots' kinds and subjects count as seen lately.
const RECENT_KINDS = 3;
const RECENT_SUBJECTS = 6;
const REALM_MS = 9_000;
const RAID_MS = 14_000;
const OMEN_MS = 10_000;
const DRAGON_MAX_MS = 40_000;
const CUT_MS = 900;
const GLIDE_MS = 2_600;
const MANUAL_MS = 60_000;
// Before a shot ends, how soon to start streaming the room the camera goes to next.
const PRELOAD_MS = 7_000;
const MAX_SCALE = 70;
// Tiles the dragon flies per tick (see townDragon).
const DRAGON_SPEED = 62 / 47;

const PHASE_WORDS: Record<string, string> = {
  dawn: "Dawn breaks over the realm",
  dusk: "Dusk settles on the realm",
  night: "Night falls, and the watch is set",
};

export class Director {
  mode: "director" | "manual" = "director";
  // Manual until this time; Infinity when the director is switched off.
  manualUntil = 0;
  pinned: string | null = null;
  camera: View = { x: 0, y: 0, scale: 4 };

  private shot: Shot | null = null;
  private move: Move | null = null;
  private geom: Geometry = { w: 1280, h: 720, bar: 0 };
  private visitKey: string | null = null;
  private departedKey: string | null = null;
  private visitShots = 0;
  private visitsSinceRealm = 0;
  private upNext: string | null = null;
  private recent: string[] = [];
  private recentKinds: string[] = [];
  private readonly filmed = new Set<string>();
  private card: { at: number; name: string; sub: string } | null = null;
  private subject: { at: number; name: string; detail: string } | null = null;

  constructor(private readonly store: Store, private readonly cinema: Cinema) {
    store.on((e) => this.onEvent(e));
  }

  /** The camera for this frame, and how far faded to black. */
  update(now: number, geom: Geometry, dt: number): { view: View; fade: number } {
    this.geom = geom;
    if (this.mode === "manual" && now >= this.manualUntil) this.resume(now);
    if (this.mode === "manual") return { view: this.camera, fade: 0 };

    this.checkInterrupts(now);
    const shot = this.shot;
    if (!shot || now >= shot.start + shot.dur || (!this.move && now >= shot.start + MIN_SHOT_MS && shot.done?.(now))) this.next(now);
    if (!this.shot) return { view: this.camera, fade: 0 };

    if (this.card && now >= this.card.at) {
      this.cinema.title(this.card.name, this.card.sub, now);
      this.card = null;
    }
    if (this.subject && now >= this.subject.at) {
      this.cinema.introduce(this.subject.name, this.subject.detail, now);
      this.subject = null;
    }

    const target = this.shot.frame(now);
    let view = target;
    let fade = 0;
    if (this.move) {
      const m = this.move;
      const t = clamp((now - m.start) / m.dur, 0, 1);
      if (m.kind === "cut") {
        fade = 1 - Math.abs(2 * t - 1);
        view = t < 0.5 ? m.from : target;
      } else if (m.kind === "glide") {
        view = blend(m.from, target, easeInOutCubic(t));
      } else {
        view = fly(m.from, target, t, m.peak);
      }
      if (t >= 1) this.move = null;
    } else if (this.shot.follow) {
      // Keep with a walking creep without jerking at each turn.
      const k = 1 - Math.exp(-dt / 450);
      view = {
        x: this.camera.x + (target.x - this.camera.x) * k,
        y: this.camera.y + (target.y - this.camera.y) * k,
        scale: target.scale,
      };
    }
    this.camera = view;
    return { view, fade };
  }

  /** The rooms to stream in full: the one filmed, and the next before the camera goes there. */
  focus(now: number): string[] {
    if (this.mode === "manual") {
      if (this.camera.scale < 4) return [];
      const key = realmLayout(this.store).rooms.find((k) => {
        const o = roomOrigin(k);
        return o && this.camera.x >= o.x - 0.5 && this.camera.x < o.x + 49.5 && this.camera.y >= o.y - 0.5 && this.camera.y < o.y + 49.5;
      });
      return key ? [key] : [];
    }
    const keys: string[] = [];
    // Over the realm map the castle last visited keeps streaming, so the sky keeps time.
    const filming = this.shot?.key ?? this.visitKey;
    if (filming) keys.push(filming);
    if (this.move?.kind === "travel" && this.departedKey) keys.push(this.departedKey);
    else if (this.upNext) keys.push(this.upNext);
    // Near the end of any shot, as the visit may end with it.
    else if (this.shot && this.shot.start + this.shot.dur - now < PRELOAD_MS) {
      const next = this.nextCastle();
      if (next) keys.push(next.key);
    }
    return [...new Set(keys)].slice(0, 2);
  }

  /** The creep the director is filming, while the camera is with it. */
  featured(): { key: string; id: string } | null {
    if (this.mode !== "director" || this.move?.kind === "travel" || !this.shot?.key || !this.shot.subject) return null;
    return { key: this.shot.key, id: this.shot.subject };
  }

  /** Hands the camera to the viewer for a while, or for good when `forever`. */
  takeOver(now: number, forever = false): void {
    this.mode = "manual";
    this.manualUntil = forever ? Infinity : Math.max(this.manualUntil, now + MANUAL_MS);
    this.move = null;
  }

  toggle(now: number): void {
    if (this.mode === "manual") this.resume(now);
    else this.takeOver(now, true);
  }

  pin(key: string | null, now: number): void {
    this.pinned = key;
    if (this.mode === "manual") this.resume(now);
    const castle = key ? this.store.castleOf(key) : this.nextCastle();
    if (castle) this.visit(castle, now);
  }

  step(dir: 1 | -1, now: number): void {
    const castles = this.store.castles;
    if (castles.length === 0) return;
    const i = castles.findIndex((c) => c.key === this.visitKey);
    const c = castles[(i + dir + castles.length) % castles.length];
    if (this.pinned) this.pinned = c.key;
    if (this.mode === "manual") this.resume(now);
    this.visit(c, now);
  }

  showRealm(now: number): void {
    if (this.mode === "manual") this.resume(now);
    const shard = this.shot?.shard ?? this.store.castles[0]?.shard;
    if (shard) this.begin(this.realmShot(shard, now), "travel", now);
  }

  describe(now: number): { place: string; mode: string; shard: string | null; castle: string | null } {
    const castle = this.visitKey ? this.store.castleOf(this.visitKey) : undefined;
    let place = "The Realm";
    if (this.shot?.kind !== "realm" && this.shot?.key) {
      const c = this.store.castleOf(this.shot.key);
      place = c ? `${c.name}  ·  ${c.room}` : this.shot.key;
    }
    let mode = "Director";
    if (this.mode === "manual") {
      mode = this.manualUntil === Infinity ? "Free camera" : `Free camera, director returns in ${Math.ceil((this.manualUntil - now) / 1000)}s`;
    } else if (this.pinned) {
      mode = `Keeping to ${castle?.name ?? "one castle"}`;
    }
    return { place, mode, shard: this.shot?.shard ?? castle?.shard ?? null, castle: this.visitKey };
  }

  private resume(now: number): void {
    this.mode = "director";
    this.manualUntil = 0;
    // Back to whichever castle is nearest the camera.
    let best: Castle | undefined;
    let bestD = Infinity;
    for (const c of this.store.castles) {
      const o = roomOrigin(c.key);
      if (!o) continue;
      const d = Math.hypot(o.x + 24.5 - this.camera.x, o.y + 24.5 - this.camera.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    const target = this.pinned ? this.store.castleOf(this.pinned) : best;
    this.shot = null;
    if (target) this.visit(target, now);
  }

  private onEvent(e: StoreEvent): void {
    const now = performance.now();
    switch (e.type) {
      case "castle-won":
        this.cinema.caption(`A new castle rises: ${e.castle.name}`, "chronicle", now);
        // The realm, with the new castle on it, then a flight there.
        if (this.mode === "director" && !this.pinned) {
          this.upNext = e.castle.key;
          this.begin(this.realmShot(e.castle.shard, now, 7000), "travel", now);
        }
        break;
      case "castle-lost":
        this.cinema.caption(`${e.castle.name} has fallen`, "raid", now);
        break;
      case "chronicle":
        this.cinema.caption(e.text, "chronicle", now);
        break;
      case "phase":
        if (PHASE_WORDS[e.phase]) this.cinema.caption(PHASE_WORDS[e.phase], "omen", now);
        break;
    }
  }

  private nextCastle(): Castle | undefined {
    const castles = this.store.castles;
    if (castles.length === 0) return undefined;
    if (this.pinned) return this.store.castleOf(this.pinned);
    const i = castles.findIndex((c) => c.key === this.visitKey);
    return castles[(i + 1) % castles.length];
  }

  private next(now: number): void {
    if (this.upNext) {
      const c = this.store.castleOf(this.upNext);
      this.upNext = null;
      if (c) return this.visit(c, now);
    }
    const castles = this.store.castles;
    if (castles.length === 0) {
      const shard = [...realmLayout(this.store).bounds.keys()][0];
      if (shard) this.begin(this.realmShot(shard, now), "glide", now);
      return;
    }
    const here = this.visitKey ? this.store.castleOf(this.visitKey) : undefined;
    if (!here) return this.visit(castles[0], now);

    const raided = this.store.foreigners(here.key).length > 0;
    if (raided) return this.begin(this.raidShot(here.key, here.shard, now), "glide", now);

    if (this.visitShots >= SHOTS_PER_VISIT && !this.pinned) {
      const next = this.nextCastle()!;
      this.visitsSinceRealm++;
      if (this.visitsSinceRealm >= Math.max(castles.length, 2)) {
        this.visitsSinceRealm = 0;
        this.upNext = next.key;
        return this.begin(this.realmShot(here.shard, now), "travel", now);
      }
      return this.visit(next, now);
    }
    if (this.visitShots >= SHOTS_PER_VISIT) this.visitShots = 0;

    const live = this.store.live.get(here.key);
    const fresh = !!live && this.store.isFresh(live, now);
    const pick = fresh ? this.interest(live, now) : null;
    // Nothing new worth a closer look: on to the next castle, or, kept to
    // this one, a wide shot until something happens. A castle whose stream
    // has not caught up yet is held on the wide shot until it does.
    if (!pick) {
      if (fresh && !this.pinned && castles.length > 1) {
        this.visitShots = SHOTS_PER_VISIT;
        return this.next(now);
      }
      this.visitShots++;
      return this.begin(this.establishShot(here.key, here.shard, now), this.shot?.kind === "establish" ? "glide" : "cut", now);
    }
    this.visitShots++;
    const shot = pick.follow && pick.id ? this.followShot(here.key, here.shard, pick.id, now) : this.detailShot(here.key, here.shard, pick, now);
    if (pick.id && pick.creep) {
      shot.subject = pick.id;
      shot.done ??= this.doneWith(here.key, pick.id, pick.kind);
    }
    this.begin(shot, this.shot?.kind === "establish" || Math.random() < 0.4 ? "glide" : "cut", now);
    if (pick.id) this.recent = [pick.id, ...this.recent].slice(0, RECENT_SUBJECTS);
    this.recentKinds = [pick.kind, ...this.recentKinds].slice(0, RECENT_KINDS);
    if (pick.name && !pick.creep) this.subject = { at: shot.start + 600, name: pick.name, detail: pick.detail ?? "" };
  }

  // Whether a creep filmed for what it was doing has stopped doing it: gone,
  // stood still a while when it was filmed walking, or idle when it was filmed at work.
  private doneWith(key: string, id: string, kind: string): (now: number) => boolean {
    let still = 0;
    let seen: number | null = null;
    return () => {
      const r = this.store.live.get(key);
      const o = r?.objects[id];
      if (!r || !o) return true;
      if (r.gameTime === seen) return false;
      seen = r.gameTime;
      const m = r.motion.get(id);
      const moving = !!m && (m.fx !== m.tx || m.fy !== m.ty);
      const busy = moving || r.effects.some((e) => e.id === id && e.kind !== "say");
      // Walkers are let stand a tick or two, as at a door or in a crowd.
      still = (WALKING.has(kind) ? moving : busy) ? 0 : still + 1;
      return still >= 2;
    };
  }

  // Flies (or cuts, across shards) to a castle and opens on its establishing shot with its name.
  private visit(c: Castle, now: number): void {
    const from = this.shot?.key ?? null;
    const how = from === c.key ? "cut" : this.shot && this.shot.shard === c.shard ? "travel" : "cut";
    if (from !== c.key) this.departedKey = from;
    this.visitKey = c.key;
    this.visitShots = 1;
    const shot = this.establishShot(c.key, c.shard, now);
    this.begin(shot, how, now);
    if (from !== c.key) {
      const level = c.level ? `Level ${c.level} castle` : "Castle";
      this.card = { at: shot.start, name: c.name, sub: `${level}  ·  ${c.room}  ·  ${c.shard}` };
    }
  }

  private begin(shot: Shot, how: Move["kind"], now: number): void {
    const from = { ...this.camera };
    const to = shot.frame(shot.start);
    let dur = how === "cut" ? CUT_MS : GLIDE_MS;
    let peak = Math.min(from.scale, to.scale);
    if (how === "travel") {
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      dur = clamp(3200 + dist * 9, 3500, 7500);
      peak = Math.min(peak, this.fit(Math.abs(to.x - from.x) + 70, Math.abs(to.y - from.y) + 70));
    }
    // The shot's own clock starts once the camera has arrived.
    const arrive = how === "cut" ? dur / 2 : dur;
    shot.start = now + arrive;
    this.shot = shot;
    this.move = { kind: how, start: now, dur, from, peak };
  }

  private checkInterrupts(now: number): void {
    const shot = this.shot;
    // Raiders at any castle's gates (or the kept castle's, when one is kept).
    const raided = this.store.castles.filter((c) => (!this.pinned || c.key === this.pinned) && this.store.foreigners(c.key).length > 0);
    if (raided.length > 0 && !(shot?.kind === "raid" && raided.some((c) => c.key === shot.key))) {
      const c = raided.find((r) => r.key === this.visitKey) ?? raided[0];
      this.cinema.caption(this.raidWords(c), "raid", now);
      if (this.visitKey !== c.key) {
        this.departedKey = this.visitKey;
        this.visitKey = c.key;
        this.visitShots = SHOTS_PER_VISIT - 1;
      }
      const how = shot?.key === c.key ? "glide" : shot?.shard === c.shard ? "travel" : "cut";
      this.begin(this.raidShot(c.key, c.shard, now), how, now);
      return;
    }
    if (!shot || !this.visitKey || shot.kind === "raid" || shot.kind === "dragon" || this.move) return;

    const lore = this.store.lore.get(shot.shard);
    if (!lore) return;
    const key = this.visitKey;
    if (lore.dragon && lore.dragon.t < 30) {
      const flight = `dragon:${lore.gameTime - lore.dragon.t}`;
      if (!this.filmed.has(flight)) {
        this.filmed.add(flight);
        this.cinema.caption("A dragon crosses the sky", "omen", now);
        const left = (48 - lore.dragon.t) * lore.tickMs;
        return this.begin(this.dragonShot(key, shot.shard, Math.min(DRAGON_MAX_MS, left), now), "glide", now);
      }
    }
    if (shot.kind === "omen") return;
    if (lore.howl && lore.howl.t <= 1) {
      const howl = `howl:${lore.gameTime - lore.howl.t}`;
      if (!this.filmed.has(howl)) {
        this.filmed.add(howl);
        this.cinema.caption("Wolves howl beyond the walls", "omen", now);
        return this.begin(this.omenShot(key, shot.shard, lore.howl.x, lore.howl.y, 2.4, now), "glide", now);
      }
    }
    if (lore.star && lore.star.t <= 1) {
      const star = `star:${lore.gameTime - lore.star.t}`;
      if (!this.filmed.has(star)) {
        this.filmed.add(star);
        this.cinema.caption("A star falls", "omen", now);
        return this.begin(this.omenShot(key, shot.shard, lore.star.x, lore.star.y + 4, 1.5, now), "glide", now);
      }
    }
  }

  private raidWords(c: Castle): string {
    const live = this.store.live.get(c.key);
    const foe = this.store.foreigners(c.key)[0];
    if (foe === INVADER) return `Raiders at the gates of ${c.name}!`;
    const name = live?.users[foe]?.username;
    return name ? `${name}'s host marches on ${c.name}!` : `Foes at the gates of ${c.name}!`;
  }

  // What in the room is most worth a closer look, chosen at random among the
  // best few of what weighs at least MIN_INTEREST: a fight, a stranger, a
  // creep about to be raised, a merchant laden with gold, a speaker, a
  // builder. What was filmed lately, and the sort of thing filmed lately,
  // weigh less among them.
  private interest(r: LiveRoom, now: number): Pick | null {
    const picks = roomInterest(r, this.store.me?.id, now, this.store.tickMs(this.shot?.shard ?? "")).filter((p) => p.weight >= MIN_INTEREST);
    for (const p of picks) {
      if (p.id && this.recent.includes(p.id)) p.weight *= 0.1;
      if (this.recentKinds.includes(p.kind)) p.weight *= 0.3;
    }
    const best = picks.sort((a, b) => b.weight - a.weight).slice(0, 3).filter((p, _, all) => p.weight >= all[0].weight * 0.5);
    if (best.length === 0) return null;
    let roll = Math.random() * best.reduce((s, p) => s + p.weight, 0);
    for (const p of best) {
      roll -= p.weight;
      if (roll <= 0) return p;
    }
    return best[best.length - 1];
  }

  private fit(boxW: number, boxH: number): number {
    return fitScale(this.geom.w, this.geom.h, this.geom.bar, boxW, boxH);
  }

  private roomScale(): number {
    return this.fit(52, 52);
  }

  private establishShot(key: string, shard: string, now: number): Shot {
    const o = roomOrigin(key)!;
    const dx = (Math.random() - 0.5) * 6;
    const dy = (Math.random() - 0.5) * 3;
    const shot: Shot = {
      kind: "establish",
      key,
      shard,
      start: now,
      dur: ESTABLISH_MS,
      frame: (t) => {
        const p = clamp((t - shot.start) / shot.dur, 0, 1);
        const s = this.roomScale() * 0.97;
        return { x: o.x + 24.5 + dx * (p - 0.5), y: o.y + 24.5 + dy * (p - 0.5), scale: s * (1 + 0.12 * easeInOutSine(p)) };
      },
    };
    return shot;
  }

  private detailShot(key: string, shard: string, pick: Pick, now: number): Shot {
    const o = roomOrigin(key)!;
    const a = Math.random() * Math.PI * 2;
    const shot: Shot = {
      kind: "detail",
      key,
      shard,
      start: now,
      dur: DETAIL_MS,
      frame: (t) => {
        const p = clamp((t - shot.start) / shot.dur, 0, 1);
        const s = Math.min(MAX_SCALE, this.roomScale() * 2.6);
        return { x: o.x + pick.x + Math.cos(a) * 2.5 * (p - 0.5), y: o.y + pick.y + Math.sin(a) * 1.5 * (p - 0.5), scale: s * (1 + 0.05 * p) };
      },
    };
    return shot;
  }

  private followShot(key: string, shard: string, id: string, now: number): Shot {
    const o = roomOrigin(key)!;
    let last = { x: 25, y: 25 };
    const shot: Shot = {
      kind: "follow",
      key,
      shard,
      start: now,
      dur: FOLLOW_MS,
      follow: id,
      frame: (t) => {
        const r = this.store.live.get(key);
        if (r && r.objects[id]) last = creepPosition(r, id, t, this.store.tickMs(shard));
        return { x: o.x + last.x, y: o.y + last.y, scale: Math.min(MAX_SCALE, this.roomScale() * 3) };
      },
    };
    return shot;
  }

  private realmShot(shard: string, now: number, dur = REALM_MS): Shot {
    const shot: Shot = {
      kind: "realm",
      key: null,
      shard,
      start: now,
      dur,
      frame: (t) => {
        const b = realmLayout(this.store).bounds.get(shard) ?? [0, 0, 50, 50];
        const p = clamp((t - shot.start) / shot.dur, 0, 1);
        const s = this.fit(b[2] - b[0] + 40, b[3] - b[1] + 40);
        return { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, scale: s * (1 + 0.06 * easeInOutSine(p)) };
      },
    };
    return shot;
  }

  private raidShot(key: string, shard: string, now: number): Shot {
    const o = roomOrigin(key)!;
    const shot: Shot = {
      kind: "raid",
      key,
      shard,
      start: now,
      dur: RAID_MS,
      frame: (t) => {
        const foes = this.foePositions(key, t);
        const cx = foes.length ? foes.reduce((s, f) => s + f.x, 0) / foes.length : 24.5;
        const cy = foes.length ? foes.reduce((s, f) => s + f.y, 0) / foes.length : 24.5;
        return { x: o.x + lerp(24.5, cx, 0.6), y: o.y + lerp(24.5, cy, 0.6), scale: Math.min(MAX_SCALE, this.roomScale() * 1.5) };
      },
    };
    return shot;
  }

  private foePositions(key: string, now: number): Array<{ x: number; y: number }> {
    const r = this.store.live.get(key);
    const me = this.store.me?.id;
    if (r && this.store.isFresh(r, now)) {
      const out: Array<{ x: number; y: number }> = [];
      for (const id in r.objects) {
        const o = r.objects[id];
        if (o.type === "creep" && o.user !== me) out.push(creepPosition(r, id, now, this.store.tickMs(this.shot?.shard ?? "")));
      }
      if (out.length) return out;
    }
    const view = this.store.maps.get(key) ?? {};
    const out: Array<{ x: number; y: number }> = [];
    for (const user of this.store.foreigners(key)) for (const p of view[user] as Array<[number, number]>) out.push({ x: p[0], y: p[1] });
    return out;
  }

  private dragonShot(key: string, shard: string, dur: number, now: number): Shot {
    const o = roomOrigin(key)!;
    const shot: Shot = {
      kind: "dragon",
      key,
      shard,
      start: now,
      dur,
      frame: (t) => {
        const lore = this.store.lore.get(shard);
        const d = lore?.dragon;
        const s = Math.min(MAX_SCALE, this.roomScale() * 1.7);
        if (!lore || !d) return { x: o.x + 24.5, y: o.y + 24.5, scale: s };
        const ticks = (t - lore.at) / lore.tickMs;
        const x = d.x + d.dir * DRAGON_SPEED * ticks;
        return { x: o.x + clamp(x, 10, 39), y: o.y + clamp(d.y, 10, 39), scale: s };
      },
    };
    return shot;
  }

  private omenShot(key: string, shard: string, x: number, y: number, zoom: number, now: number): Shot {
    const o = roomOrigin(key)!;
    const shot: Shot = {
      kind: "omen",
      key,
      shard,
      start: now,
      dur: OMEN_MS,
      frame: (t) => {
        const p = clamp((t - shot.start) / shot.dur, 0, 1);
        const s = Math.min(MAX_SCALE, this.roomScale() * zoom);
        return { x: o.x + clamp(x, 10, 39), y: o.y + clamp(y, 8, 41), scale: s * (1 + 0.08 * p) };
      },
    };
    return shot;
  }
}

// How much each sort of thing is worth filming. A fight above all, then
// strangers, a creep about to step out of its barracks, speech, building and
// laying claim, gold carried home; the work done day in, day out, the least.
const KIND_WEIGHT: Record<string, number> = {
  fight: 30,
  stranger: 20,
  raised: 10,
  say: 7,
  claim: 6,
  build: 5,
  haul: 3,
  upgrade: 3,
  repair: 2,
  harvest: 2,
  walk: 1,
  idle: 0.1,
};
// The sorts of thing filmed following the creep, and ended once it stands.
const WALKING = new Set(["haul", "walk"]);
// Ticks before a creep is raised that it is worth watching for.
const RAISED_SOON_TICKS = 4;

/** Everything in a room the director might film, each weighed by how much is going on. */
export function roomInterest(r: LiveRoom, me: string | undefined, now: number, tickMs: number): Pick[] {
  const actions = new Map<string, string[]>();
  for (const e of r.effects) actions.set(e.id, [...(actions.get(e.id) ?? []), e.kind]);
  const picks: Pick[] = [];
  for (const id in r.objects) {
    const o = r.objects[id];
    if (o.type === "creep" && !o.spawning) {
      const did = actions.get(id) ?? [];
      const m = r.motion.get(id);
      const moving = !!m && (m.fx !== m.tx || m.fy !== m.ty);
      const cargo = Object.values((o.store ?? {}) as Record<string, number>).reduce((s, n) => s + (Number(n) || 0), 0);
      let kind = moving ? (cargo > 0 ? "haul" : "walk") : "idle";
      if (did.includes("harvest")) kind = "harvest";
      if (did.includes("repair")) kind = "repair";
      if (did.includes("upgrade")) kind = "upgrade";
      if (did.includes("build")) kind = "build";
      if (did.includes("claim")) kind = "claim";
      if (did.includes("say")) kind = "say";
      if (o.user !== me) kind = "stranger";
      if (did.some((k) => k === "attack" || k === "ranged" || k === "mass" || k === "heal")) kind = "fight";
      let weight = KIND_WEIGHT[kind];
      // The more gold carried, the better the story; a full merchant's load
      // is worth half again as much as a porter's handful.
      if (kind === "haul") weight += Math.min(3, cargo / 300);
      if (typeof o.name === "string" && o.name.startsWith("Minstrel")) weight += 4;
      const at = creepPosition(r, id, now, tickMs);
      picks.push({ id, x: at.x, y: at.y, follow: moving, name: o.name, detail: describeCreep(o, did, r), kind, weight, creep: true });
    } else if (o.type === "spawn" && o.spawning && typeof o.spawning === "object") {
      const left = typeof o.spawning.spawnTime === "number" && r.gameTime !== null ? o.spawning.spawnTime - r.gameTime : Infinity;
      const soon = left <= RAISED_SOON_TICKS;
      picks.push({ id, x: o.x, y: o.y, follow: false, name: o.spawning.name, detail: soon ? `about to step out of ${o.name}` : `being raised at ${o.name}`, kind: "raised", weight: soon ? KIND_WEIGHT.raised : 1, creep: false });
    } else if (o.type === "tower" && (actions.get(id) ?? []).some((k) => k === "tower-attack" || k === "tower-heal")) {
      picks.push({ id, x: o.x, y: o.y, follow: false, kind: "fight", weight: KIND_WEIGHT.fight, creep: false });
    }
  }
  return picks;
}

export function describeCreep(o: Record<string, any>, did: string[], r: LiveRoom): string {
  const gold = Number(o.store?.energy) || 0;
  const say = r.effects.find((e) => e.id === o._id && e.kind === "say")?.text;
  if (say) return `“${say}”`;
  if (did.includes("attack") || did.includes("ranged") || did.includes("mass")) return "in the thick of battle";
  if (did.includes("heal")) return "tending the wounded";
  if (did.includes("upgrade")) return "raising the castle";
  if (did.includes("build")) return "building";
  if (did.includes("repair")) return "mending the walls";
  if (did.includes("harvest")) return "mining gold";
  if (did.includes("claim")) return "laying claim to the land";
  if (gold > 0) return `carrying ${gold.toLocaleString()} gold`;
  return "about the castle";
}

function blend(a: View, b: View, p: number): View {
  return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), scale: Math.exp(lerp(Math.log(a.scale), Math.log(b.scale), p)) };
}

// A flight: the camera pulls back to `peak` as it crosses and comes in again,
// zoom eased in log scale so the pull back reads as one movement.
export function fly(a: View, b: View, t: number, peak: number): View {
  const la = Math.log(a.scale);
  const lb = Math.log(b.scale);
  const lp = Math.log(Math.min(peak, a.scale, b.scale));
  // A quadratic through la, lb whose middle reaches lp.
  const lc = 2 * lp - (la + lb) / 2;
  const ls = (1 - t) * (1 - t) * la + 2 * t * (1 - t) * lc + t * t * lb;
  const p = easeInOutCubic(t);
  return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), scale: Math.exp(ls) };
}
