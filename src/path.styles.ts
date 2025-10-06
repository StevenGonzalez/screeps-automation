/**
 * Path Styles: semantic colors and widths for creep path visualization
 *
 * Keep colors consistent across the codebase so lines "mean something" at a glance.
 */

/// <reference types="@types/screeps" />

export type PathIntent =
  | "move" // neutral moves / wandering
  | "harvest" // heading to sources
  | "withdraw" // pulling energy from containers/storage/terminal
  | "transfer" // delivering energy
  | "build" // building sites
  | "repair" // repairing structures
  | "upgrade" // controller upgrades
  | "attack" // offensive actions
  | "heal" // medical aid
  | "flee"; // emergency retreat

// Central palette (WCAG-friendly-ish on dark terrain)
// Feel free to tweak to taste. Avoid too many similar hues.
export const PATH_STYLES: Record<PathIntent, PolyStyle> = {
  move: { stroke: "#bbbbbb", opacity: 0.25, strokeWidth: 0.15 },
  harvest: { stroke: "#ffaa00", opacity: 0.25, strokeWidth: 0.15 }, // amber
  withdraw: { stroke: "#0a84ff", opacity: 0.25, strokeWidth: 0.15 }, // blue
  transfer: { stroke: "#00d26a", opacity: 0.25, strokeWidth: 0.18 }, // green
  build: { stroke: "#ffffff", opacity: 0.25, strokeWidth: 0.15 }, // white
  repair: { stroke: "#00ffff", opacity: 0.25, strokeWidth: 0.15 }, // cyan
  upgrade: { stroke: "#ff00ff", opacity: 0.25, strokeWidth: 0.15 }, // magenta
  attack: { stroke: "#ff3b30", opacity: 0.25, strokeWidth: 0.2 }, // red
  heal: { stroke: "#34c759", opacity: 0.25, strokeWidth: 0.18 }, // lime green
  flee: { stroke: "#ff0000", opacity: 0.25, strokeWidth: 0.12 }, // thin urgent red
};

export function style(intent: PathIntent): PolyStyle {
  return PATH_STYLES[intent];
}
