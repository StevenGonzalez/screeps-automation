// Dumb-little-bug notices for controller signing. Simple, small, sincere. Keep under 100 chars.
export const SIGNATURES: string[] = [
  "bug lives here. this good dirt.",
  "we found the shiny. it is ours now.",
  "many legs live here. please no step.",
  "we chewed this room. it is home now.",
  "beware: bugs. not smart, but many.",
  "the pile is ours. do not touch the pile.",
  "we do not know what we do, but we do it here.",
  "found food. stayed. this home now.",
  "us bugs live here. thank you. bye.",
  "big rock good. we stay by big rock.",
  "this our room. we forget why. but ours.",
  "no boot please. we are small and we try.",
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
