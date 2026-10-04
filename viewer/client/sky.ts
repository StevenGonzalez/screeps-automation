// The realm's sky at any moment, worked out by the bot's own lore code (see
// services.town) at a fractional tick, so the light and the weather move
// smoothly between ticks instead of jumping with each one: how bright it is
// and of what colour, where the sun throws shadows, and which omens are out.

import {
  DAY_START,
  NIGHT_START,
  townAurora,
  townClock,
  townDragon,
  townFallingStar,
  townFeast,
  townHowl,
  townMist,
  townMoon,
  townSeason,
  townStorm,
  townWisps,
  type DragonFlight,
  type FallingStar,
  type Howl,
} from "../../src/services/services.town";
import { TOWN_DAY_LENGTH, TOWN_MOON_DAYS, type TownPhase, type TownSeason } from "../../src/config/config.town";

export type Rgb = [number, number, number];

export interface Sky {
  time: number;
  // Ticks into the day, fractional.
  t: number;
  phase: TownPhase;
  season: TownSeason;
  feast: string | undefined;
  storm: boolean;
  // The light over the realm, multiplied into the picture: white by day.
  ambient: Rgb;
  // How much lamps and fires show against the dark, 0 by day to 1 at night.
  glow: number;
  // Whether the town's lamps, torches and braziers burn, 0 to 1: lit at dusk
  // and put out at dawn, as the bot has it.
  lit: number;
  // Where shadows fall, in tiles along the ground per tile of height, and how dark.
  shadow: { dx: number; dy: number; alpha: number };
  // The moon's age in days, and how far its light carries (0 new, 1 full).
  moon: number;
  moonlight: number;
  // The northern lights' strength, 0 when they are not up.
  aurora: number;
  wisps: boolean;
  // The morning mist's thickness, 0 when there is none.
  mist: number;
  // A flash of lightning, 0 to 1, and the tick it struck on.
  lightning: number;
  boltTick: number;
  star: FallingStar | undefined;
  howl: Howl | undefined;
  dragon: DragonFlight | undefined;
}

// The colour of the light through the day, by ticks into the day: violet
// before dawn, rose at sunrise, white by day, gold and orange at sunset,
// purple at dusk and deep blue all night.
const AMBIENT: Array<[number, Rgb]> = [
  [0, [104, 96, 150]],
  [45, [222, 168, 168]],
  [DAY_START, [255, 240, 225]],
  [250, [255, 255, 255]],
  [540, [255, 238, 205]],
  [615, [244, 168, 120]],
  [670, [150, 112, 158]],
  [NIGHT_START + 20, [60, 72, 118]],
  [950, [60, 72, 118]],
  [TOWN_DAY_LENGTH, [104, 96, 150]],
];

// A storm's grey, and winter's cold cast.
const STORM: Rgb = [0.5, 0.54, 0.62];
const WINTER: Rgb = [0.95, 0.98, 1.02];
// A full moon's silver, and how far it lifts the night towards it.
const SILVER: Rgb = [150, 158, 182];
const MOONLIGHT = 0.3;
// Lightning strikes on one tick in this many of a storm, as the bot draws it.
const LIGHTNING_EVERY = 37;
// The sun crosses the sky from dawn until dusk ends.
const SUNSET = NIGHT_START;
// How long a mist takes to thicken at first light, and to burn off before day.
const MIST_RISE = 20;
const MIST_FADE = 40;
// How long the northern lights take to brighten after nightfall, and to fade before dawn.
const AURORA_FADE = 60;
// The longest a shadow may stretch, in tiles per tile of height.
const LONGEST_SHADOW = 3.2;

function ambientAt(t: number): Rgb {
  for (let i = 1; i < AMBIENT.length; i++) {
    const [t1, c1] = AMBIENT[i];
    if (t > t1) continue;
    const [t0, c0] = AMBIENT[i - 1];
    const k = (t - t0) / (t1 - t0);
    return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
  }
  return AMBIENT[AMBIENT.length - 1][1];
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The sky at `time`, a fractional game tick. */
export function skyAt(time: number): Sky {
  const t = ((time % TOWN_DAY_LENGTH) + TOWN_DAY_LENGTH) % TOWN_DAY_LENGTH;
  const { phase } = townClock(time);
  const season = townSeason(time);
  const storm = townStorm(time);
  const moon = townMoon(time);
  // 0 at the new moon, 1 at the full.
  const fullness = 1 - Math.abs(moon - TOWN_MOON_DAYS / 2) / (TOWN_MOON_DAYS / 2);
  const night = phase === "night" || phase === "dusk";

  let ambient = ambientAt(t);
  // Only the night is brightened by the moon, and only a clear one.
  const nightness = clamp01((t - 640) / 80) * (1 - clamp01((t - 960) / 40)) || 0;
  const moonlight = storm ? 0 : fullness * nightness;
  ambient = ambient.map((c, i) => c + (SILVER[i] - c) * MOONLIGHT * moonlight) as Rgb;
  if (storm) ambient = ambient.map((c, i) => c * STORM[i]) as Rgb;
  if (season === "winter") ambient = ambient.map((c, i) => c * WINTER[i]) as Rgb;

  const tick = Math.floor(time);
  const struck = storm && tick % LIGHTNING_EVERY === 0;
  // A bolt flashes twice in the first moments of its tick.
  const f = time - tick;
  const lightning = struck ? Math.max(clamp01(1 - f / 0.12), 0.7 * clamp01(1 - Math.abs(f - 0.22) / 0.08)) : 0;
  if (lightning > 0) ambient = ambient.map((c) => c + (255 - c) * 0.8 * lightning) as Rgb;
  ambient = ambient.map((c) => Math.min(255, c)) as Rgb;

  const luminance = (0.3 * ambient[0] + 0.55 * ambient[1] + 0.15 * ambient[2]) / 255;
  const glow = clamp01((0.92 - luminance) / 0.55);
  const lit = night ? clamp01((t - 600) / 12) * clamp01((TOWN_DAY_LENGTH - t) / 12) : 0;

  // The sun rises in the east, stands high in the north at midday and sets
  // in the west, so shadows swing from west through south to east. Up here
  // the north is the top of the screen, so they fall towards the viewer,
  // out from under what casts them, where they can be seen.
  let shadow = { dx: 0, dy: 0, alpha: 0 };
  if (t < SUNSET) {
    const along = t / SUNSET;
    const azimuth = Math.PI * along;
    const height = Math.sin(Math.PI * along);
    const length = Math.min(LONGEST_SHADOW, 0.45 / Math.max(0.05, height));
    shadow = {
      dx: -Math.cos(azimuth) * length,
      dy: Math.sin(azimuth) * length * 0.6,
      alpha: (storm ? 0.12 : 0.42) * clamp01(height / 0.18),
    };
  } else if (moonlight > 0.2) {
    // A bright moon in the north-east throws faint shadows south-west.
    shadow = { dx: -0.5, dy: 0.35, alpha: 0.16 * moonlight };
  }

  const aurora = townAurora(time) ? clamp01(Math.min((t - NIGHT_START) / AURORA_FADE, (TOWN_DAY_LENGTH - t) / AURORA_FADE)) : 0;
  const mist = townMist(time) ? clamp01(Math.min((t + 1) / MIST_RISE, (DAY_START - t) / MIST_FADE)) : 0;

  return {
    time,
    t,
    phase,
    season,
    feast: townFeast(time),
    storm,
    ambient,
    glow,
    lit,
    shadow,
    moon,
    moonlight,
    aurora,
    wisps: townWisps(time),
    mist,
    lightning,
    boltTick: struck ? tick : -1,
    star: townFallingStar(time),
    howl: townHowl(time),
    dragon: townDragon(time),
  };
}
