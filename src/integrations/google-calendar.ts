import { google } from 'googleapis';
import type { calendar_v3 } from 'googleapis';

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  startAuckland: string;
  endAuckland: string;
  allDay: boolean;
  location?: string;
  description?: string;
  attendees?: string[];
  htmlLink?: string;
}

const AUCKLAND_TZ = 'Pacific/Auckland';

function formatAuckland(iso: string): string {
  if (!iso) return iso;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-NZ', {
    timeZone: AUCKLAND_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function getAuth(writeAccess = false) {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  console.log('[calendar] GOOGLE_SERVICE_ACCOUNT_JSON defined:', !!json);
  console.log('[calendar] raw value length:', json?.length ?? 0);

  if (!json) throw new Error('[google-calendar] GOOGLE_SERVICE_ACCOUNT_JSON is not set');

  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(json);
    console.log('[calendar] credentials type:', credentials.type);
    console.log('[calendar] client_email:', credentials.client_email);
  } catch (e) {
    console.log('[calendar] JSON parse error:', e instanceof Error ? e.message : e);
    console.log('[calendar] first 100 chars of raw value:', json.slice(0, 100));
    throw new Error('[google-calendar] GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON — check for unescaped newlines or quotes');
  }

  const scopes = writeAccess
    ? ['https://www.googleapis.com/auth/calendar']
    : ['https://www.googleapis.com/auth/calendar.readonly'];

  try {
    const auth = new google.auth.GoogleAuth({ credentials, scopes });
    console.log('[calendar] GoogleAuth created successfully');
    return auth;
  } catch (e) {
    console.log('[calendar] GoogleAuth setup error:', e instanceof Error ? e.message : e);
    if (e instanceof Error) console.log('[calendar] stack:', e.stack);
    throw e;
  }
}

function getCalendarId(): string {
  const id = process.env.GOOGLE_CALENDAR_ID;
  console.log('[calendar] GOOGLE_CALENDAR_ID:', id ?? '(not set)');
  if (!id) throw new Error('[google-calendar] GOOGLE_CALENDAR_ID is not set');
  return id;
}

function mapEvent(e: calendar_v3.Schema$Event): CalendarEvent {
  const allDay = !e.start?.dateTime;
  const start = e.start?.dateTime ?? e.start?.date ?? '';
  const end = e.end?.dateTime ?? e.end?.date ?? '';
  return {
    id: e.id ?? '',
    title: e.summary ?? '(no title)',
    start,
    end,
    startAuckland: allDay ? start : formatAuckland(start),
    endAuckland: allDay ? end : formatAuckland(end),
    allDay,
    location: e.location ?? undefined,
    description: e.description ?? undefined,
    attendees: e.attendees?.map(a => a.email ?? '').filter(Boolean),
    htmlLink: e.htmlLink ?? undefined,
  };
}

export async function readCalendarEvents(days = 7): Promise<CalendarEvent[]> {
  const calendarId = getCalendarId();
  const cal = google.calendar({ version: 'v3', auth: getAuth() });

  const now = new Date();
  const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const res = await cal.events.list({
    calendarId,
    timeMin: now.toISOString(),
    timeMax: until.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 50,
  });

  return (res.data.items ?? []).map(mapEvent);
}

export async function createCalendarEvent(params: {
  title: string;
  start: string;
  end: string;
  description?: string;
  attendees?: string[];
}): Promise<{ id: string; htmlLink: string }> {
  const calendarId = getCalendarId();
  const cal = google.calendar({ version: 'v3', auth: getAuth(true) });

  const res = await cal.events.insert({
    calendarId,
    requestBody: {
      summary: params.title,
      start: { dateTime: params.start },
      end: { dateTime: params.end },
      description: params.description,
      attendees: params.attendees?.map(email => ({ email })),
    },
  });

  return {
    id: res.data.id ?? '',
    htmlLink: res.data.htmlLink ?? '',
  };
}

export async function updateCalendarEvent(params: {
  eventId: string;
  title?: string;
  start?: string;
  end?: string;
  description?: string;
  attendees?: string[];
}): Promise<CalendarEvent> {
  const calendarId = getCalendarId();
  const cal = google.calendar({ version: 'v3', auth: getAuth(true) });

  // Fetch first so we only patch the fields provided
  const existing = await cal.events.get({ calendarId, eventId: params.eventId });
  const patch: calendar_v3.Schema$Event = {};

  if (params.title !== undefined) patch.summary = params.title;
  if (params.description !== undefined) patch.description = params.description;
  if (params.start !== undefined) patch.start = { dateTime: params.start };
  if (params.end !== undefined) patch.end = { dateTime: params.end };
  if (params.attendees !== undefined) patch.attendees = params.attendees.map(email => ({ email }));

  const res = await cal.events.patch({
    calendarId,
    eventId: params.eventId,
    requestBody: patch,
  });

  return mapEvent({ ...existing.data, ...res.data });
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const calendarId = getCalendarId();
  const cal = google.calendar({ version: 'v3', auth: getAuth(true) });
  await cal.events.delete({ calendarId, eventId });
}
