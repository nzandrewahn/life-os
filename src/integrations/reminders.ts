import { DAVClient, type DAVCalendar } from 'tsdav';
import { randomUUID } from 'crypto';

let client: DAVClient | null = null;
let taskCalendar: DAVCalendar | null = null;

async function getClient(): Promise<DAVClient> {
  if (client) return client;

  console.log('[reminders] initialising DAVClient');
  console.log('[reminders] username:', process.env.ICLOUD_USERNAME);
  console.log('[reminders] password set:', !!process.env.ICLOUD_APP_PASSWORD);

  const c = new DAVClient({
    serverUrl: 'https://caldav.icloud.com',
    credentials: {
      username: process.env.ICLOUD_USERNAME!,
      password: process.env.ICLOUD_APP_PASSWORD!,
    },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });

  try {
    console.log('[reminders] calling client.login()');
    await c.login();
    console.log('[reminders] login successful');
    client = c;
    return client;
  } catch (err) {
    console.error('[reminders] login failed:', err instanceof Error ? err.message : err);
    if (err instanceof Error) console.error('[reminders] stack:', err.stack);
    throw err;
  }
}

async function getTaskCalendar(): Promise<DAVCalendar> {
  if (taskCalendar) return taskCalendar;

  const c = await getClient();

  let calendars: DAVCalendar[];
  try {
    console.log('[reminders] fetching calendars');
    calendars = await c.fetchCalendars();
    console.log(`[reminders] found ${calendars.length} calendar(s)`);
    for (const cal of calendars) {
      console.log(`[reminders]   - "${cal.displayName ?? '(no name)'}" | url: ${cal.url} | components: ${JSON.stringify(cal.components)}`);
    }
  } catch (err) {
    console.error('[reminders] fetchCalendars failed:', err instanceof Error ? err.message : err);
    if (err instanceof Error) console.error('[reminders] stack:', err.stack);
    throw err;
  }

  const vtodoCal = calendars.find(cal =>
    Array.isArray(cal.components) && cal.components.includes('VTODO')
  );
  const chosen = vtodoCal ?? calendars[0];

  if (!chosen) throw new Error('[reminders] no calendars found on iCloud account');

  console.log(`[reminders] selected calendar: "${chosen.displayName ?? '(no name)'}" | ${chosen.url}`);
  taskCalendar = chosen;
  return taskCalendar;
}

export async function testConnection(): Promise<void> {
  console.log('[reminders] --- connection test start ---');
  try {
    await getTaskCalendar();
    console.log('[reminders] --- connection test passed ---');
  } catch (err) {
    console.error('[reminders] --- connection test FAILED ---');
    console.error('[reminders]', err instanceof Error ? err.message : err);
  }
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

  try {
    console.log(`[reminders] creating reminder: "${params.title}"`);
    await c.createCalendarObject({
      calendar: cal,
      filename: `${uid}.ics`,
      iCalString: lines.join('\r\n'),
    });
    console.log(`[reminders] created: "${params.title}"`);
  } catch (err) {
    console.error('[reminders] createCalendarObject failed:', err instanceof Error ? err.message : err);
    if (err instanceof Error) console.error('[reminders] stack:', err.stack);
    throw err;
  }
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
