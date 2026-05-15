import { google } from 'googleapis';

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
}

function getAuth() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error('[google-calendar] GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  const credentials = JSON.parse(json);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });
}

export async function readCalendarEvents(days = 7): Promise<CalendarEvent[]> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) throw new Error('[google-calendar] GOOGLE_CALENDAR_ID is not set');

  const auth = getAuth();
  const cal = google.calendar({ version: 'v3', auth });

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

  const items = res.data.items ?? [];
  return items.map(e => {
    const allDay = !e.start?.dateTime;
    return {
      id: e.id ?? '',
      title: e.summary ?? '(no title)',
      start: e.start?.dateTime ?? e.start?.date ?? '',
      end: e.end?.dateTime ?? e.end?.date ?? '',
      allDay,
      location: e.location ?? undefined,
      description: e.description ?? undefined,
    };
  });
}
