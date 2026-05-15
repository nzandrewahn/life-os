import {
  createAccount,
  createCalendarObject,
  getBasicAuthHeaders,
  type DAVAccount,
  type DAVCalendar,
} from 'tsdav';
import { randomUUID } from 'crypto';

let cachedAccount: DAVAccount | null = null;
let cachedCalendar: DAVCalendar | null = null;

async function getTaskCalendar(): Promise<{ calendar: DAVCalendar; headers: Record<string, string> }> {
  const username = process.env.ICLOUD_USERNAME;
  const password = process.env.ICLOUD_APP_PASSWORD;
  if (!username) throw new Error('[reminders] ICLOUD_USERNAME is not set');
  if (!password) throw new Error('[reminders] ICLOUD_APP_PASSWORD is not set');

  const headers = getBasicAuthHeaders({ username, password });

  if (!cachedAccount) {
    cachedAccount = await createAccount({
      account: {
        serverUrl: 'https://caldav.icloud.com',
        accountType: 'caldav',
        credentials: { username, password },
      },
      headers,
      loadCollections: true,
      loadObjects: false,
    });

    const calendars = cachedAccount.calendars ?? [];
    const vtodoLists = calendars.filter(cal =>
      Array.isArray(cal.components) && cal.components.includes('VTODO')
    );

    // Match by name prefix in case Apple appends emoji (e.g. "Reminders ⚠️")
    const named = (name: string) => vtodoLists.find(cal =>
      typeof cal.displayName === 'string' && cal.displayName.startsWith(name)
    );
    cachedCalendar = named('Reminders') ?? named('Inbox') ?? vtodoLists[0] ?? null;
    if (!cachedCalendar) throw new Error('[reminders] no VTODO calendar found on iCloud account');
    console.log(`[reminders] using list: "${cachedCalendar.displayName ?? '(no name)'}"`);
  }

  return { calendar: cachedCalendar!, headers };
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
