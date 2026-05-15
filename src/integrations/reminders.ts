import { DAVClient, type DAVCalendar } from 'tsdav';
import { randomUUID } from 'crypto';

let client: DAVClient | null = null;
let taskCalendar: DAVCalendar | null = null;

async function getClient(): Promise<DAVClient> {
  if (client) return client;
  client = new DAVClient({
    serverUrl: 'https://caldav.icloud.com',
    credentials: {
      username: process.env.ICLOUD_USERNAME!,
      password: process.env.ICLOUD_APP_PASSWORD!,
    },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
  await client.login();
  return client;
}

async function getTaskCalendar(): Promise<DAVCalendar> {
  if (taskCalendar) return taskCalendar;
  const c = await getClient();
  const calendars = await c.fetchCalendars();

  // Prefer a calendar that explicitly supports VTODO
  const vtodoCal = calendars.find(cal =>
    Array.isArray(cal.components) && cal.components.includes('VTODO')
  );

  const chosen = vtodoCal ?? calendars[0];
  if (!chosen) throw new Error('No calendars found on iCloud account');

  console.log(`[reminders] using calendar: ${chosen.displayName ?? chosen.url}`);
  taskCalendar = chosen;
  return taskCalendar;
}

export async function createReminder(params: {
  title: string;
  dueDate?: Date;
  notes?: string;
}): Promise<void> {
  const c = await getClient();
  const cal = await getTaskCalendar();
  const uid = randomUUID();
  const now = toIcalDate(new Date());

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Caterina//EN',
    'BEGIN:VTODO',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `SUMMARY:${icalEscape(params.title)}`,
    'STATUS:NEEDS-ACTION',
  ];

  if (params.dueDate) lines.push(`DUE:${toIcalDate(params.dueDate)}`);
  if (params.notes) lines.push(`DESCRIPTION:${icalEscape(params.notes)}`);

  lines.push('END:VTODO', 'END:VCALENDAR');

  await c.createCalendarObject({
    calendar: cal,
    filename: `${uid}.ics`,
    iCalString: lines.join('\r\n'),
  });
}

function toIcalDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function icalEscape(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}
