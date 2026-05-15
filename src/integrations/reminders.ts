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
    console.log('[reminders] creating account via well-known discovery');
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
    console.log('[reminders] account ready, homeUrl:', cachedAccount.homeUrl);

    const calendars = cachedAccount.calendars ?? [];
    console.log(`[reminders] found ${calendars.length} calendar(s):`);
    for (const cal of calendars) {
      console.log(`[reminders]   "${cal.displayName ?? '(no name)'}" | components: ${JSON.stringify(cal.components)} | url: ${cal.url}`);
    }

    // Only consider VTODO-capable lists, skip any with emoji in the name
    const hasEmoji = (s: string | Record<string, unknown>) =>
      typeof s === 'string' && /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u.test(s);
    const vtodoLists = calendars.filter(cal =>
      Array.isArray(cal.components) &&
      cal.components.includes('VTODO') &&
      !hasEmoji(cal.displayName ?? '')
    );

    const named = (name: string) => vtodoLists.find(cal => cal.displayName === name);
    cachedCalendar = named('Reminders') ?? named('Inbox') ?? vtodoLists[0] ?? null;
    if (!cachedCalendar) throw new Error('[reminders] no suitable VTODO calendar found on iCloud account');
    console.log(`[reminders] selected: "${cachedCalendar.displayName ?? '(no name)'}" | ${cachedCalendar.url}`);
  }

  return { calendar: cachedCalendar!, headers };
}

export async function createReminder(params: {
  title: string;
  dueDate?: Date;
  notes?: string;
}): Promise<void> {
  console.log('[caldav debug] env check:', {
    username: process.env.ICLOUD_USERNAME,
    passwordLength: process.env.ICLOUD_APP_PASSWORD?.length ?? 0,
    allEnvKeys: Object.keys(process.env).filter(k =>
      k.includes('ICLOUD') || k.includes('APPLE')
    ),
  });
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
