// Corporate memos for controller signing. Passive-aggressive, relentlessly polite. Keep under 100 chars.
export const SIGNATURES: string[] = [
  "Per my last message, this room has been acquired. Thanks!",
  "Circling back: this controller now reports to us.",
  "This room is now a synergy hub. Please update your calendars.",
  "Friendly reminder: this space is booked through end of quarter.",
  "We've taken this offline. Happy to sync if you have questions.",
  "Going forward, please route all harvesting through our team.",
  "Not sure if you saw my previous email, but this room is ours.",
  "Excited to announce this room has joined our family of rooms!",
  "Let's take this conversation offline. Also, the room. We took it.",
  "Moving forward, this room is aligned with our core values.",
  "Kindly vacate. There is cake in the break room (there is no cake).",
  "New hire orientation is at 9am. You are not invited. Thanks!",
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
