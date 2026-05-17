// Shared in-memory state used across bot and crons
export const lastMessageWasEveningCheckIn = new Map<string, boolean>();

export function setEveningCheckInSent(chatId: string): void {
  lastMessageWasEveningCheckIn.set(chatId, true);
}
