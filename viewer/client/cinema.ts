// The picture's frame: letterbox bars carrying the realm's HUD, the ledger
// of the castle on screen and the realm's chronicle, the dossier of the creep
// in the picture, title cards, captions, the fade between cuts, and the film
// grain over the picture, on its own layer of the page (see index.html).

import { clamp, easeInOutSine, screenTransform, type Frame } from "./camera";
import type { Dossier } from "./dossier";

export type Tone = "chronicle" | "raid" | "omen" | "quiet";

const TONE_COLOURS: Record<Tone, string> = {
  chronicle: "#f2c14e",
  raid: "#ff6b5a",
  omen: "#c9d4ec",
  quiet: "#d8cfb8",
};

interface Caption {
  text: string;
  tone: Tone;
  at: number;
  until: number;
}

interface Card {
  name: string;
  sub: string;
  at: number;
}

interface Subject {
  name: string;
  detail: string;
  at: number;
}

export interface HudCastle {
  name: string;
  level: number;
  current: boolean;
  raided: boolean;
  live: boolean;
}

export interface Hud {
  realm: string;
  place: string;
  clock: string;
  castles: HudCastle[];
  mode: string;
  stats: string;
  warning: string | null;
  // The castle under the camera as the bot last summed it up, and how much it shows.
  ledger: CastleDigest | null;
  ledgerAlpha: number;
  // The chronicle's latest entries, oldest first.
  chronicle: Array<{ when: string; text: string }>;
  // The creep the picture is about, or the one the viewer chose.
  dossier: Dossier | null;
}

const TITLE_FONT = `"Cinzel", "Trajan Pro", Georgia, serif`;
const TEXT_FONT = `"IM Fell English", Georgia, serif`;
const CARD_MS = 6500;
const SUBJECT_MS = 5000;
const CAPTION_MS = 7000;
const MAX_CAPTIONS = 3;
// The ledger's width and its labels' column, and the chronicle's widest line, in pixels.
const LEDGER_W = 330;
const LEDGER_LABEL_W = 98;
const CHRONICLE_W = 420;
// The dossier's width, its fade in milliseconds, and its body pips' size and spacing in pixels.
const DOSSIER_W = 290;
const DOSSIER_FADE_MS = 400;
const PIP = 7;
const PIP_STEP = 10;
// The film grain's tile, in pixels.
const GRAIN_PX = 160;
// Each body part's colour on the dossier.
const PART_COLOURS: Record<string, string> = {
  move: "#9aa58a",
  work: "#d9a441",
  carry: "#a07a4c",
  attack: "#c8483c",
  ranged: "#5f8fc0",
  heal: "#7fc08a",
  claim: "#a47ad0",
  tough: "#9a9a9a",
};
// What the realm's gold is spent on and earned from, as the ledger names it.
const BOOK_NAMES: Record<string, string> = {
  mines: "mines",
  vendors: "vendors",
  recruits: "recruits",
  enchant: "enchanting",
  masonry: "masonry",
  smithy: "smithy",
  towers: "towers",
};

export class Cinema {
  letterbox = true;
  hudShown = true;
  private bar = 0;
  private card: Card | null = null;
  private subject: Subject | null = null;
  private captions: Caption[] = [];
  private dossier: { d: Dossier; alpha: number } | null = null;
  private lastNow = 0;

  /** `grain` is the element the film grain is tiled on. */
  constructor(private readonly grain: HTMLElement) {
    const c = document.createElement("canvas");
    c.width = c.height = GRAIN_PX;
    const g = c.getContext("2d")!;
    const img = g.createImageData(GRAIN_PX, GRAIN_PX);
    for (let p = 0; p < img.data.length; p += 4) {
      const v = Math.random() * 255;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
      img.data[p + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grain.style.backgroundImage = `url(${c.toDataURL()})`;
  }

  /** The letterbox bars' height this frame, easing in and out as they are toggled. */
  barHeight(w: number, h: number, dt: number): number {
    const want = this.letterbox ? Math.max(0, (h - w / 2.2) / 2) : 0;
    this.bar += (want - this.bar) * (1 - Math.exp(-dt / 250));
    if (Math.abs(want - this.bar) < 0.5) this.bar = want;
    return this.bar;
  }

  title(name: string, sub: string, now: number): void {
    this.card = { name, sub, at: now };
  }

  introduce(name: string, detail: string, now: number): void {
    this.subject = { name, detail, at: now };
  }

  caption(text: string, tone: Tone, now: number): void {
    if (this.captions.some((c) => c.text === text && c.until > now)) return;
    this.captions.push({ text, tone, at: now, until: now + CAPTION_MS });
    while (this.captions.length > MAX_CAPTIONS) this.captions.shift();
  }

  draw(f: Frame, fade: number, hud: Hud): void {
    const { ctx, w, h } = f;
    screenTransform(f);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    const shift = Math.floor(Math.random() * GRAIN_PX);
    this.grain.style.backgroundPosition = `${shift}px ${(shift * 7) % GRAIN_PX}px`;

    if (fade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${clamp(fade, 0, 1)})`;
      ctx.fillRect(0, 0, w, h);
    }

    const bar = f.bar;
    if (bar > 0.5) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, bar);
      ctx.fillRect(0, h - bar, w, bar);
    }
    if (this.hudShown) this.drawHud(f, hud);
    this.drawCard(f);
    // The dossier fades out before another takes its place.
    const dt = clamp(f.now - this.lastNow, 0, 100);
    this.lastNow = f.now;
    const want = hud.dossier;
    if (this.dossier && (!want || want.id !== this.dossier.d.id)) this.dossier.alpha -= dt / DOSSIER_FADE_MS;
    else if (want) this.dossier = { d: want, alpha: Math.min(1, (this.dossier?.alpha ?? 0) + dt / DOSSIER_FADE_MS) };
    if (this.dossier && this.dossier.alpha <= 0) this.dossier = null;
    if (this.dossier) this.drawDossier(f, this.dossier.d, easeInOutSine(this.dossier.alpha));
    else this.drawSubject(f);
    this.drawCaptions(f);
  }

  private drawHud(f: Frame, hud: Hud): void {
    const { ctx, w, h } = f;
    // Without bars the HUD sits on a shade over the picture.
    const band = Math.max(f.bar, 0);
    const top = band > 34 ? band / 2 : 22;
    const bottom = band > 34 ? h - band / 2 : h - 22;
    if (band <= 34) {
      for (const [y0, y1] of [[0, 52], [h, h - 52]]) {
        const g = ctx.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, "rgba(0,0,0,0.7)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, Math.min(y0, y1), w, 52);
      }
    }
    const pad = Math.max(16, w * 0.025);
    ctx.textBaseline = "middle";

    ctx.font = `600 13px ${TITLE_FONT}`;
    ctx.letterSpacing = "4px";
    ctx.textAlign = "left";
    ctx.fillStyle = "#b8a372";
    ctx.fillText(hud.realm.toUpperCase(), pad, top);
    ctx.letterSpacing = "0px";

    ctx.font = `italic 15px ${TEXT_FONT}`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#e8dcc0";
    ctx.fillText(hud.place, w / 2, top);

    ctx.textAlign = "right";
    ctx.fillStyle = "#a89e88";
    ctx.fillText(hud.clock, w - pad, top);

    // The castles along the bottom, the one on screen lit.
    ctx.textAlign = "left";
    let x = pad;
    for (const c of hud.castles) {
      ctx.font = `${c.current ? "700" : "400"} 13px ${TITLE_FONT}`;
      ctx.letterSpacing = "1px";
      const label = `${c.name}`;
      const lw = ctx.measureText(label).width;
      const dot = c.raided ? `rgba(255,107,90,${0.6 + 0.4 * Math.sin(f.now / 200)})` : c.live ? "#f2c14e" : "#5a5446";
      ctx.beginPath();
      ctx.arc(x + 4, bottom, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = dot;
      ctx.fill();
      ctx.fillStyle = c.current ? "#f5e6c0" : "#8f8670";
      ctx.fillText(label, x + 14, bottom);
      ctx.letterSpacing = "0px";
      ctx.font = `italic 13px ${TEXT_FONT}`;
      ctx.fillStyle = "#7d7562";
      const lvl = c.level ? ` ${c.level}` : "";
      ctx.fillText(lvl, x + 14 + lw, bottom);
      x += 14 + lw + ctx.measureText(lvl).width + 26;
      if (x > w * 0.6) break;
    }
    ctx.letterSpacing = "0px";

    ctx.textAlign = "right";
    ctx.font = `italic 14px ${TEXT_FONT}`;
    ctx.fillStyle = "#a89e88";
    ctx.fillText(`${hud.stats}   ·   ${hud.mode}`, w - pad, bottom);

    if (hud.warning) {
      ctx.textAlign = "center";
      ctx.fillStyle = `rgba(255,140,110,${0.7 + 0.3 * Math.sin(f.now / 400)})`;
      ctx.fillText(hud.warning, w / 2, bottom);
    }

    // Under the top bar: the castle's ledger on the left, the chronicle on the right.
    const below = (band > 34 ? band : 52) + 14;
    if (hud.ledger && hud.ledgerAlpha > 0.01) this.drawLedger(f, hud.ledger, hud.ledgerAlpha, pad, below);
    if (hud.chronicle.length > 0) this.drawChronicle(f, hud.chronicle, w - pad, below);
  }

  // The castle's state, as its steward would keep it: level, gold, treasury,
  // books, people, and any trouble.
  private drawLedger(f: Frame, c: CastleDigest, alpha: number, left: number, top: number): void {
    const { ctx, w } = f;
    const width = Math.min(LEDGER_W, w * 0.4);
    const x = left + 14;
    const inner = width - 24;
    const lines: Array<(y: number) => void> = [];
    const row = (label: string, value: string, colour = "#e8dcc0", extra?: { text: string; colour: string }) =>
      lines.push((y) => {
        ctx.textAlign = "left";
        ctx.font = `600 10px ${TITLE_FONT}`;
        ctx.letterSpacing = "2px";
        ctx.fillStyle = "#8f8670";
        ctx.fillText(label, x, y);
        ctx.letterSpacing = "0px";
        ctx.font = `14px ${TEXT_FONT}`;
        ctx.fillStyle = colour;
        const v = fit(ctx, value, inner - LEDGER_LABEL_W);
        ctx.fillText(v, x + LEDGER_LABEL_W, y);
        if (!extra) return;
        ctx.font = `italic 13px ${TEXT_FONT}`;
        ctx.fillStyle = extra.colour;
        ctx.fillText(extra.text, x + LEDGER_LABEL_W + ctx.measureText(`${v}  `).width + 4, y);
      });
    const note = (text: string, colour: string, indent = 0) =>
      lines.push((y) => {
        ctx.textAlign = "left";
        ctx.font = `italic 13px ${TEXT_FONT}`;
        ctx.fillStyle = colour;
        ctx.fillText(fit(ctx, text, inner - indent), x + indent, y);
      });

    const goldFrac = c.goldCap > 0 ? c.gold / c.goldCap : 0;
    row("GOLD", c.goldCap > 0 ? `${c.gold.toLocaleString()} of ${c.goldCap.toLocaleString()}` : "no barracks yet", goldFrac < 0.3 ? "#e8907a" : "#e8dcc0");
    if (c.treasury !== null) {
      const trend = c.trend === null ? undefined : { text: `${signed(c.trend)} a tick`, colour: c.trend >= 0 ? "#a8c686" : "#e8907a" };
      row("TREASURY", thousands(c.treasury), "#e8dcc0", trend);
    }
    const earned = Object.entries(c.income).filter(([, n]) => (n ?? 0) >= 0.05);
    const spent = Object.entries(c.spend).filter(([, n]) => (n ?? 0) >= 0.05);
    if (earned.length + spent.length > 0) {
      const net = earned.reduce((s, [, n]) => s + n!, 0) - spent.reduce((s, [, n]) => s + n!, 0);
      row("EXCHEQUER", `${signed(net)} a tick`, net >= 0 ? "#f2c14e" : "#e8907a");
      const books = (entries: Array<[string, number | undefined]>) =>
        entries.sort((a, b) => b[1]! - a[1]!).map(([k, n]) => `${BOOK_NAMES[k] ?? k} ${n!.toFixed(1)}`).join(", ");
      if (earned.length > 0) note(`in: ${books(earned)}`, "#a89e88", LEDGER_LABEL_W);
      if (spent.length > 0) note(`out: ${books(spent)}`, "#a89e88", LEDGER_LABEL_W);
    }
    if (c.keep) note(c.keep, "#f2c14e");
    const folk = [c.home, c.townsfolk > 0 ? `${c.townsfolk} townsfolk` : ""].filter(Boolean).join(" · ");
    if (folk) row("AT HOME", folk);
    if (c.abroad) row("ABROAD", c.abroad);
    if (c.mustering) row("MUSTERING", `${c.mustering.name}, ${c.mustering.ticks} ticks`, "#c8bfa8");
    if (c.raiders > 0) note(`Raiders about the castle: ${c.raiders}`, `rgba(255,107,90,${0.75 + 0.25 * Math.sin(f.now / 200)})`);

    const head = 48;
    const lineH = 19;
    const height = head + lines.length * lineH + 8;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textBaseline = "middle";
    ctx.beginPath();
    ctx.roundRect(left, top, width, height, 3);
    ctx.fillStyle = "rgba(10,8,6,0.58)";
    ctx.fill();
    ctx.fillStyle = "#f2c14e";
    ctx.fillRect(left, top, 2, height);

    ctx.textAlign = "left";
    ctx.font = `600 16px ${TITLE_FONT}`;
    ctx.letterSpacing = "2px";
    ctx.fillStyle = "#f2dfae";
    ctx.fillText(fit(ctx, c.name, inner), x, top + 16);
    ctx.letterSpacing = "0px";
    ctx.font = `italic 13px ${TEXT_FONT}`;
    ctx.fillStyle = "#a89e88";
    ctx.fillText(`Level ${c.level} · ${c.phase}`, x, top + 34);
    if (c.progress !== null) {
      // The way to the next level: a thin gold line under the name.
      const bx = x + 118;
      const bw = inner - 118 - 34;
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(bx, top + 33, bw, 3);
      ctx.fillStyle = "#f2c14e";
      ctx.fillRect(bx, top + 33, bw * clamp(c.progress, 0, 1), 3);
      ctx.textAlign = "right";
      ctx.fillText(`${Math.floor(c.progress * 100)}%`, x + inner, top + 34);
    }
    lines.forEach((draw, i) => draw(top + head + 10 + i * lineH));
    ctx.restore();
  }

  // The Royal Chronicle's latest entries, the newest last and brightest.
  private drawChronicle(f: Frame, entries: Array<{ when: string; text: string }>, right: number, top: number): void {
    const { ctx, w } = f;
    const most = Math.min(CHRONICLE_W, w * 0.34);
    // Each entry as it fits: its words, cut short if need be, then its date.
    ctx.save();
    const lines = entries.map((e) => {
      ctx.font = `italic 12px ${TEXT_FONT}`;
      const whenW = ctx.measureText(e.when).width + 12;
      ctx.font = `italic 14px ${TEXT_FONT}`;
      const text = fit(ctx, e.text, most - whenW);
      return { ...e, text, whenW, width: whenW + ctx.measureText(text).width };
    });
    const inner = Math.max(150, ...lines.map((l) => l.width));
    const x = right - 14;
    const height = 36 + lines.length * 21;
    ctx.beginPath();
    ctx.roundRect(right - inner - 26, top, inner + 26, height, 3);
    ctx.fillStyle = "rgba(10,8,6,0.58)";
    ctx.fill();
    ctx.fillStyle = "#f2c14e";
    ctx.fillRect(right - 2, top, 2, height);

    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.font = `600 11px ${TITLE_FONT}`;
    ctx.letterSpacing = "3px";
    ctx.fillStyle = "#b8a372";
    // The letter spacing trails the last letter; drawn that much further right.
    ctx.fillText("ROYAL CHRONICLE", x + 3, top + 15);
    ctx.letterSpacing = "0px";
    lines.forEach((e, i) => {
      const y = top + 38 + i * 21;
      const fresh = i === lines.length - 1;
      ctx.globalAlpha = fresh ? 1 : 0.55 + (0.3 * i) / Math.max(1, lines.length - 1);
      ctx.font = `italic 12px ${TEXT_FONT}`;
      ctx.fillStyle = "#8f8670";
      ctx.fillText(e.when, x, y);
      ctx.font = `italic 14px ${TEXT_FONT}`;
      ctx.fillStyle = fresh ? "#ffe9a8" : "#c8bfa8";
      ctx.fillText(e.text, x - e.whenW, y);
    });
    ctx.restore();
  }

  private drawCard(f: Frame): void {
    if (!this.card) return;
    const { ctx, w, h } = f;
    const age = f.now - this.card.at;
    if (age > CARD_MS) {
      this.card = null;
      return;
    }
    const a = age < 1400 ? easeInOutSine(age / 1400) : age > CARD_MS - 1600 ? easeInOutSine((CARD_MS - age) / 1600) : 1;
    const size = clamp(w * 0.045, 30, 76);
    const y = h / 2 - size * 0.2 - (age / CARD_MS) * 8;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 24;
    ctx.font = `600 ${size}px ${TITLE_FONT}`;
    ctx.letterSpacing = `${(0.1 + 0.04 * (age / CARD_MS)) * size}px`;
    ctx.fillStyle = "#f2dfae";
    ctx.fillText(this.card.name.toUpperCase(), w / 2, y);
    ctx.letterSpacing = "0px";
    const rule = size * 3.2 * a;
    ctx.strokeStyle = "rgba(242,193,78,0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2 - rule, y + size * 0.42);
    ctx.lineTo(w / 2 - 10, y + size * 0.42);
    ctx.moveTo(w / 2 + 10, y + size * 0.42);
    ctx.lineTo(w / 2 + rule, y + size * 0.42);
    ctx.stroke();
    ctx.save();
    ctx.translate(w / 2, y + size * 0.42);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = "#f2c14e";
    ctx.fillRect(-3.5, -3.5, 7, 7);
    ctx.restore();
    ctx.font = `italic ${size * 0.36}px ${TEXT_FONT}`;
    ctx.fillStyle = "#d8cfb8";
    ctx.fillText(this.card.sub, w / 2, y + size * 1.05);
    ctx.restore();
  }

  // A card on the creep in the picture: its name and doing, its cargo, its
  // health and years, and its body as a row of pips for each kind of part.
  private drawDossier(f: Frame, d: Dossier, alpha: number): void {
    const { ctx, w, h } = f;
    const width = Math.min(DOSSIER_W, w * 0.4);
    const left = Math.max(16, w * 0.025);
    const x = left + 14;
    const inner = width - 24;
    const perRow = Math.max(1, Math.floor((inner - 86) / PIP_STEP));
    const rows = d.body.map((g) => Math.ceil(g.count / perRow));
    const height = 56 + (d.cargo ? 20 : 0) + 20 + (d.life ? 20 : 0) + rows.reduce((s, n) => s + n * 13 + 4, 0) + 8;
    const bottom = h - f.bar - Math.max(34, h * 0.05);
    const top = bottom - height;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.roundRect(left, top, width, height, 3);
    ctx.fillStyle = "rgba(10,8,6,0.62)";
    ctx.fill();
    ctx.fillStyle = d.foe ? "#ff6b5a" : "#f2c14e";
    ctx.fillRect(left, top, 2, height);

    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = `600 18px ${TITLE_FONT}`;
    ctx.letterSpacing = "2px";
    ctx.fillStyle = d.foe ? "#ffb4a8" : "#f2dfae";
    ctx.fillText(fit(ctx, d.name, inner), x, top + 20);
    ctx.letterSpacing = "0px";
    ctx.font = `italic 14px ${TEXT_FONT}`;
    ctx.fillStyle = "#c8bfa8";
    ctx.fillText(fit(ctx, d.detail, inner), x, top + 41);

    // A bar and its reading: the cargo in gold, the health in red, the ticks left to live in grey.
    const bar = (y: number, frac: number, colour: string, text: string) => {
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(x, y - 3, 86, 6);
      ctx.fillStyle = colour;
      ctx.fillRect(x, y - 3, 86 * clamp(frac, 0, 1), 6);
      ctx.font = `13px ${TEXT_FONT}`;
      ctx.fillStyle = "#e8dcc0";
      ctx.fillText(fit(ctx, text, inner - 98), x + 98, y);
    };
    let y = top + 64;
    if (d.cargo) {
      const { amount, capacity, what } = d.cargo;
      bar(y, capacity > 0 ? amount / capacity : 1, "#f2c14e", capacity > 0 ? `${amount.toLocaleString()} of ${capacity.toLocaleString()} ${what}` : `${amount.toLocaleString()} ${what}`);
      y += 20;
    }
    bar(y, d.hitsMax > 0 ? d.hits / d.hitsMax : 1, "#c8483c", `${d.hits.toLocaleString()} of ${d.hitsMax.toLocaleString()} hits`);
    y += 20;
    if (d.life) {
      bar(y, d.life.left / d.life.span, "#a9b0b8", `${d.life.left.toLocaleString()} ticks left`);
      y += 20;
    }

    // The body: a diamond for each part, hollow where broken, ringed where boosted.
    for (const [i, g] of d.body.entries()) {
      const colour = PART_COLOURS[g.part] ?? "#c8bfa8";
      for (let p = 0; p < g.count; p++) {
        const px = x + 3 + (p % perRow) * PIP_STEP;
        const py = y + Math.floor(p / perRow) * 13;
        ctx.beginPath();
        ctx.moveTo(px, py - PIP / 2);
        ctx.lineTo(px + PIP / 2, py);
        ctx.lineTo(px, py + PIP / 2);
        ctx.lineTo(px - PIP / 2, py);
        ctx.closePath();
        if (p < g.count - g.broken) {
          ctx.fillStyle = colour;
          ctx.fill();
        } else {
          ctx.strokeStyle = colour;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        if (p < g.boosted) {
          ctx.strokeStyle = "#fff2c8";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      ctx.font = `italic 13px ${TEXT_FONT}`;
      ctx.fillStyle = "#a89e88";
      ctx.textAlign = "right";
      ctx.fillText(`${g.part} ×${g.count}`, x + inner, y);
      ctx.textAlign = "left";
      y += rows[i] * 13 + 4;
    }
    ctx.restore();
  }

  private drawSubject(f: Frame): void {
    if (!this.subject) return;
    const { ctx, w, h } = f;
    const age = f.now - this.subject.at;
    if (age > SUBJECT_MS) {
      this.subject = null;
      return;
    }
    const a = age < 600 ? age / 600 : age > SUBJECT_MS - 900 ? (SUBJECT_MS - age) / 900 : 1;
    const x = Math.max(16, w * 0.025) + (1 - a) * -12;
    const y = h - f.bar - Math.max(48, h * 0.08);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#f2c14e";
    ctx.fillRect(x, y - 30, 2, 44);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `600 20px ${TITLE_FONT}`;
    ctx.letterSpacing = "2px";
    ctx.fillStyle = "#f2dfae";
    ctx.fillText(this.subject.name, x + 12, y - 8);
    ctx.letterSpacing = "0px";
    ctx.font = `italic 15px ${TEXT_FONT}`;
    ctx.fillStyle = "#c8bfa8";
    ctx.fillText(this.subject.detail, x + 12, y + 12);
    ctx.restore();
  }

  private drawCaptions(f: Frame): void {
    const { ctx, w, h } = f;
    this.captions = this.captions.filter((c) => c.until > f.now);
    if (this.captions.length === 0) return;
    const size = clamp(w * 0.013, 15, 22);
    let y = h - f.bar - Math.max(40, h * 0.06);
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `italic ${size}px ${TEXT_FONT}`;
    ctx.shadowColor = "rgba(0,0,0,0.95)";
    ctx.shadowBlur = 10;
    for (let i = this.captions.length - 1; i >= 0; i--) {
      const c = this.captions[i];
      const age = f.now - c.at;
      const a = age < 600 ? age / 600 : c.until - f.now < 1000 ? (c.until - f.now) / 1000 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.fillStyle = TONE_COLOURS[c.tone];
      ctx.fillText(c.text, w / 2, y);
      y -= size * 1.5;
    }
    ctx.restore();
  }
}

// Text cut short with an ellipsis to fit a width in the context's font.
function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid).trimEnd()}…`).width <= width) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

function signed(n: number): string {
  return n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
}

function thousands(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  return n.toLocaleString();
}
