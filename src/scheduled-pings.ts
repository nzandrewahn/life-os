export interface ScheduledPing {
  id: string;
  message: string;
  fireAt: Date;
  created: Date;
}

const scheduledPings: ScheduledPing[] = [];

export function addPing(message: string, fireAt: Date): string {
  const id = Date.now().toString();
  scheduledPings.push({ id, message, fireAt, created: new Date() });
  console.log('[ping] scheduled:', message, 'at', fireAt.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' }));
  return id;
}

export function getDuePings(): ScheduledPing[] {
  const now = new Date();
  return scheduledPings.filter(p => p.fireAt <= now);
}

export function clearPing(id: string): void {
  const idx = scheduledPings.findIndex(p => p.id === id);
  if (idx > -1) scheduledPings.splice(idx, 1);
}

export function listPings(): ScheduledPing[] {
  return [...scheduledPings];
}

console.log('[ping] in-memory store initialised — clears on redeploy');
