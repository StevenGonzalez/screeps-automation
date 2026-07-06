// Organized-crime "family" notices for controller signing. Polite menace, played straight —
// nothing overtly threatening is ever said, which is the whole joke. Keep under 100 chars.
export const SIGNATURES: string[] = [
  "Nice room. Real nice. Be a shame if anything happened to it.",
  "This block is spoken for. Nothing personal — it's just business.",
  "Under new management. We'd hate for there to be a misunderstanding.",
  "The Family thanks you for your cooperation. You've been very cooperative.",
  "We're not saying leave. We're just saying it'd be smart.",
  "This is a nice neighborhood. Let's keep it that way, capisce?",
  "Everything here is accounted for. Everything.",
  "You didn't see anything. Good. Neither did we.",
  "Territory of the Family. Enquiries handled personally.",
  "We take care of our own. We also take care of problems.",
  "Consider this a friendly reminder. There won't be a second one.",
  "This room pays its respects on time. Every time.",
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
