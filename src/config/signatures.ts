// Medieval-fantasy decrees for controller signing. Keep under 100 chars.
export const SIGNATURES: string[] = [
  "By right of conquest, this stronghold is held.",
  "A banner rises here. None shall tear it down.",
  "Held against the dark. No Chaos shall pass these walls.",
  "Forged in war, raised for the long siege to come.",
  "By blade and oath, this hold is taken.",
  "Watchfires burn upon these ramparts tonight.",
  "A garrison musters where the old road meets the gate.",
  "This keep stands. Let the hordes break upon it.",
  "Ramparts rise where braver souls once fell.",
  "Claimed and warded. Let the forges burn and the coffers fill.",
  "Borne here on dark wings, we hold this ground.",
  "By our decree, the enemy turns back at these gates.",
];

// Assign a signature ONCE per room and keep it stable thereafter. The stored
// sign text must not change between calls: signers compare the controller's
// current sign against this string and re-sign on any mismatch, so a rotating
// return value would make them re-sign (and detour to the controller) forever.
// A global cursor advances only on first assignment, so different rooms still
// get different decrees.
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
