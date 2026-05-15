import {
  createAccount,
  fetchCalendars,
  createCalendarObject,
  getBasicAuthHeaders,
  type DAVAccount,
  type DAVCalendar,
} from 'tsdav';
import { randomUUID } from 'crypto';

let account: DAVAccount | null = null;
let taskCalendar: DAVCalendar | null = null;

function getCredentials() {
  const username = process.env.ICLOUD_USERNAME;
  const password = process.env.ICLOUD_APP_PASSWORD;
  if (!username) throw new Error('[reminders] ICLOUD_USERNAME is not set');
  if (!password) throw new Error('[reminders] ICLOUD_APP_PASSWORD is not set');
  return { username, password };
}

async function getAccount(): Promise<{ account: DAVAccount; headers: Record<string, string> }> {
  if (account) {
    const { username, password } = getCredentials();
    return { account, headers: getBasicAuthHeaders({ username, password }) };
  }

  const { username, password } = getCredentials();
  const headers = getBasicAuthHeaders({ username, password });
  const principalUrl = `https://caldav.icloud.com/${username}/principal/`;

  console.log('[reminders] creating account, principalUrl:', principalUrl);

  try {
    account = await createAccount({
      account: {
        serverUrl: 'https://caldav.icloud.com',
        accountType: 'caldav',
        credentials: { username, password },
        principalUrl,
      },
      headers,
    });
    console.log('[reminders] account created, homeUrl:', account.homeUrl);
    return { account, headers };
  } catch (err) {
    console.error('[reminders] createAccount failed:', err instanceof Error ? err.message : err);
    if (err instanceof Error) console.error('[reminders] stack:', err.stack);
    throw err;
  }
}

async function getTaskCalendar(): Promise<{ calendar: DAVCalendar; headers: Record<string, string> }> {
  const { account: acc, headers } = await getAccount();

  if (taskCalendar) return { calendar: taskCalendar, headers };

  let calendars: DAVCalendar[];
  try {
    console.log('[reminders] fetching calendars');
    calendars = await fetchCalendars({ account: acc, headers });
    console.log(`[reminders] found ${calendars.length} calendar(s):`);
    for (const cal of calendars) {
      console.log(`[reminders]   "${cal.displayName ?? '(no name)'}" | components: ${JSON.stringify(cal.components)} | url: ${cal.url}`);
    }
  } catch (err) {
    console.error('[reminders] fetchCalendars failed:', err instanceof Error ? err.message : err);
    if (err instanceof Error) console.error('[reminders] stack:', err.stack);
    throw err;
  }

  // Reminders lists support VTODO; regular calendars support VEVENT
  const vtodoCal = calendars.find(cal =>
    Array.isArray(cal.components) && cal.components.includes('VTODO')
  );
  const chosen = vtodoCal ?? calendars[0];

  if (!chosen) throw new Error('[reminders] no calendars found on iCloud account');

  console.log(`[reminders] selected: "${chosen.displayName ?? '(no name)'}" | ${chosen.url}`);
  taskCalendar = chosen;
  return { calendar: taskCalendar, headers };
}

export async function testConnection(): Promise<void> {
  console.log('[reminders] --- connection test start ---');
  try {
    await getTaskCalendar();
    console.log('[reminders] --- connection test passed ---');
  } catch (err) {
    console.error('[reminders] --- connection test FAILED:', err instanceof Error ? err.message : err, '---');
  }
}

export async function createReminder(params: {
  title: string;
  dueDate?: Date;
  notes?: string;
}): Promise<void> {
  const { calendar, headers } = await getTaskCalendar();
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
    console.log(`[reminders] creating: "${params.title}"`);
    await createCalendarObject({
      calendar,
      filename: `${uid}.ics`,
      iCalString: lines.join('\r\n'),
      headers,
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
