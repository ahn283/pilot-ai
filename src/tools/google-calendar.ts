/**
 * Google Calendar integration via REST API.
 * Uses shared Google OAuth2 module for authentication.
 */
import { getGoogleAccessToken } from './google-auth.js';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  status?: string;
  htmlLink?: string;
  attendees?: Array<{ email: string; responseStatus?: string }>;
}

export interface GoogleCalendarList {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
}

async function calendarFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getGoogleAccessToken();
  const res = await fetch(`${CALENDAR_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Calendar API error (${res.status}): ${err}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Lists all calendars the user has access to.
 */
export async function listCalendars(): Promise<GoogleCalendarList[]> {
  const data = await calendarFetch<{ items: GoogleCalendarList[] }>('/users/me/calendarList');
  return data.items ?? [];
}

/**
 * Lists events for a date range.
 */
export async function listEvents(
  startDate: Date,
  endDate: Date,
  calendarId: string = 'primary',
  maxResults: number = 50,
): Promise<GoogleCalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: startDate.toISOString(),
    timeMax: endDate.toISOString(),
    maxResults: String(maxResults),
    singleEvents: 'true',
    orderBy: 'startTime',
  });

  const data = await calendarFetch<{ items: GoogleCalendarEvent[] }>(
    `/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
  );
  return data.items ?? [];
}

/**
 * Gets today's events.
 */
export async function getTodayEvents(calendarId?: string): Promise<GoogleCalendarEvent[]> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  return listEvents(start, end, calendarId);
}

/**
 * Gets this week's events.
 */
export async function getWeekEvents(calendarId?: string): Promise<GoogleCalendarEvent[]> {
  const now = new Date();
  const day = now.getDay();
  const start = new Date(now);
  start.setDate(now.getDate() - day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return listEvents(start, end, calendarId);
}

/**
 * Creates a new event.
 */
export async function createEvent(
  event: {
    summary: string;
    description?: string;
    location?: string;
    startDateTime: string;
    endDateTime: string;
    timeZone?: string;
    attendees?: string[];
  },
  calendarId: string = 'primary',
): Promise<GoogleCalendarEvent> {
  const tz = event.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body = {
    summary: event.summary,
    description: event.description,
    location: event.location,
    start: { dateTime: event.startDateTime, timeZone: tz },
    end: { dateTime: event.endDateTime, timeZone: tz },
    attendees: event.attendees?.map((email) => ({ email })),
  };

  return calendarFetch<GoogleCalendarEvent>(
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/**
 * Deletes an event by ID.
 */
export async function deleteEvent(
  eventId: string,
  calendarId: string = 'primary',
): Promise<void> {
  const token = await getGoogleAccessToken();
  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete event: ${res.status}`);
  }
}

/**
 * Finds free/busy time blocks for a given date.
 */
export async function findFreeTime(
  date: Date,
  minMinutes: number = 30,
  calendarId?: string,
): Promise<Array<{ start: Date; end: Date }>> {
  const dayStart = new Date(date);
  dayStart.setHours(9, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(18, 0, 0, 0);

  const events = await listEvents(dayStart, dayEnd, calendarId);
  const busy: Array<{ start: number; end: number }> = events
    .map((e) => ({
      start: new Date(e.start.dateTime ?? e.start.date ?? '').getTime(),
      end: new Date(e.end.dateTime ?? e.end.date ?? '').getTime(),
    }))
    .filter((e) => !isNaN(e.start) && !isNaN(e.end))
    .sort((a, b) => a.start - b.start);

  const free: Array<{ start: Date; end: Date }> = [];
  let cursor = dayStart.getTime();

  for (const slot of busy) {
    if (slot.start > cursor && slot.start - cursor >= minMinutes * 60_000) {
      free.push({ start: new Date(cursor), end: new Date(slot.start) });
    }
    cursor = Math.max(cursor, slot.end);
  }

  if (dayEnd.getTime() > cursor && dayEnd.getTime() - cursor >= minMinutes * 60_000) {
    free.push({ start: new Date(cursor), end: dayEnd });
  }

  return free;
}
