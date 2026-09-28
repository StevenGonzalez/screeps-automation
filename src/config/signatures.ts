// Royal proclamations for controller signing, in the voice of an MU Online castle. Keep under 100 chars.
export const SIGNATURES: string[] = [
  "By order of the Dark Lord, this land now answers to the castle.",
  "Traveling merchants welcome. Invaders are not.",
  "The Castle Siege is over. We won. Please wipe your boots.",
  "Taxes are due in Zen. Pay at the castle gate.",
  "Blessed +15 by our enchanters. Do not touch.",
  "Here be Budge Dragons. And us. Mostly us.",
  "Our Dragon Knights patrol these walls. Mind your step.",
  "Lorencia sends its regards. Now leave.",
  "The Chaos Machine said fail. So did your claim.",
  "Kundun stirs in the deep. This room is under our protection.",
  "Trade, barter, pass through. Just don't stay.",
  "A Dark Wizard lives here. Knock at your own risk.",
];

export function pickSignature(roomName: string): string {
  if (!Memory.rooms) Memory.rooms = {} as any;
  if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {} as any;
  const meta = Memory.rooms[roomName] as any;
  if (meta.lastSignedIndex === undefined) {
    const next = ((Memory.sigRotation ?? -1) + 1) % SIGNATURES.length;
    Memory.sigRotation = next;
    meta.lastSignedIndex = next;
  }
  return SIGNATURES[meta.lastSignedIndex];
}
