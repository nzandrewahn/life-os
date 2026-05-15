import {
  createAccount,
  fetchCalendars,
  createCalendarObject,
  getBasicAuthHeaders,
  type DAVAccount,
  type DAVCalendar,
} from 'tsdav';
import { randomUUID } from 'crypto';

// Cached per process lifetime — reset to null if credentials change
let cachedAccount: DAVAccount | null = null;
let cachedCalendar: DAVCalendar | null = null;

async function getTaskCalendar(): Promise<{ calendar: DAVCalendar; headers: Record<string, string> }> {
  // Read credentials at call time — never at module load
  const username = process.env.ICLOUD_USERNAME;
  const password = process.env.ICLOUD_APP_PASSWORD;
  if (!username) throw new Error('[reminders] ICLOUD_USERNAME is not set');
  if (!password) throw new Error('[reminders] ICLOUD_APP_PASSWORD is not set');

  const headers = getBasicAuthHeaders({ username, password });

  if (!cachedAccount) {
    const principalUrl = `https://caldav.icloud.com/${username}/principal/`;
    console.log('[reminders] creating account, principalUrl:', principalUrl);
    cachedAccount = await createAccount({
      account: {
        serverUrl: 'https://caldav.icloud.com',
        accountType: 'caldav',
        credentials: { username, password },
        principalUrl,
      },
      headers,
    });
    console.log('[reminders] account ready, homeUrl:', cachedAccount.homeUrl);
  }

  if (!cachedCalendar) {
    console.log('[reminders] fetching calendars');
    const calendars = await fetchCalendars({ account: cachedAccount, headers });
    console.log(`[reminders] found ${calendars.length} calendar(s):`);
    for (const cal of calendars) {
      console.log(`[reminders]   "${cal.displayName ?? '(no name)'}" | components: ${JSON.stringify(cal.components)} | url: ${cal.url}`);
    }
    const vtodoCal = calendars.find(cal =>
      Array.isArray(cal.components) && cal.components.includes('VTODO')
    );
    cachedCalendar = vtodoCal ?? calendars[0];
    if (!cachedCalendar) throw new Error('[reminders] no calendars found on iCloud account');
    console.log(`[reminders] selected: "${cachedCalendar.displayName ?? '(no name)'}"`);
  }

  return { calendar: cachedCalendar, headers };
}

export async function createReminder(params: {
  title: string;
  dueDate?: Date;
  notes?: string;
}): Promise<void> {
  console.log('[reminders] attempting with user:', process.env.ICLOUD_USERNAME?.slice(0, 5));

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

  console.log(`[reminders] creating: "${params.title}"`);
  try {
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
