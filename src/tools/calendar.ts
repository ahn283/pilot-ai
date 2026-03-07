/**
 * macOS Calendar integration via AppleScript + optional Google Calendar API.
 * Primary: Apple Calendar via osascript (no OAuth needed)
 */
import { executeShell } from './shell.js';

export interface CalendarEvent {
  title: string;
  startDate: string;
  endDate: string;
  location?: string;
  notes?: string;
  calendar?: string;
}

/**
 * Lists events for a date range using AppleScript.
 */
export async function listEvents(startDate: Date, endDate: Date): Promise<CalendarEvent[]> {
  const start = formatAppleScriptDate(startDate);
  const end = formatAppleScriptDate(endDate);

  const script = `
tell application "Calendar"
  set output to ""
  set startD to date "${start}"
  set endD to date "${end}"
  repeat with cal in calendars
    set calName to name of cal
    set evts to (every event of cal whose start date >= startD and start date <= endD)
    repeat with e in evts
      set output to output & calName & " | " & summary of e & " | " & (start date of e as string) & " | " & (end date of e as string) & linefeed
    end repeat
  end repeat
  return output
end tell`;

  const result = await executeShell(`osascript -e '${escapeAppleScript(script)}'`);
  if (result.exitCode !== 0) return [];

  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [calendar, title, startStr, endStr] = line.split(' | ');
      return {
        title: title?.trim() ?? '',
        startDate: startStr?.trim() ?? '',
        endDate: endStr?.trim() ?? '',
        calendar: calendar?.trim(),
      };
    })
    .filter((e) => e.title);
}

/**
 * Gets today's events.
 */
export async function getTodayEvents(): Promise<CalendarEvent[]> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  return listEvents(start, end);
}

/**
 * Gets this week's events.
 */
export async function getWeekEvents(): Promise<CalendarEvent[]> {
  const now = new Date();
  const day = now.getDay();
  const start = new Date(now);
  start.setDate(now.getDate() - day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return listEvents(start, end);
}

/**
 * Creates a new calendar event.
 */
export async function createEvent(event: CalendarEvent): Promise<void> {
  const cal = event.calendar ?? 'Calendar';
  const script = `
tell application "Calendar"
  tell calendar "${escapeAS(cal)}"
    set newEvent to make new event with properties {summary:"${escapeAS(event.title)}", start date:date "${event.startDate}", end date:date "${event.endDate}"}
    ${event.location ? `set location of newEvent to "${escapeAS(event.location)}"` : ''}
    ${event.notes ? `set description of newEvent to "${escapeAS(event.notes)}"` : ''}
  end tell
end tell`;

  const result = await executeShell(`osascript -e '${escapeAppleScript(script)}'`);
  if (result.exitCode !== 0) throw new Error(`Failed to create event: ${result.stderr}`);
}

/**
 * Deletes an event by title and date.
 */
export async function deleteEvent(title: string, date: Date): Promise<boolean> {
  const dateStr = formatAppleScriptDate(date);
  const nextDay = new Date(date);
  nextDay.setDate(date.getDate() + 1);
  const nextStr = formatAppleScriptDate(nextDay);

  const script = `
tell application "Calendar"
  repeat with cal in calendars
    set evts to (every event of cal whose summary is "${escapeAS(title)}" and start date >= date "${dateStr}" and start date < date "${nextStr}")
    repeat with e in evts
      delete e
      return "deleted"
    end repeat
  end repeat
  return "not found"
end tell`;

  const result = await executeShell(`osascript -e '${escapeAppleScript(script)}'`);
  return result.stdout.includes('deleted');
}

/**
 * Finds free time blocks for a given date.
 */
export async function findFreeTime(date: Date, minMinutes: number = 30): Promise<Array<{ start: Date; end: Date }>> {
  const dayStart = new Date(date);
  dayStart.setHours(9, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(18, 0, 0, 0);

  const events = await listEvents(dayStart, dayEnd);
  const busy: Array<{ start: number; end: number }> = events
    .map((e) => ({ start: new Date(e.startDate).getTime(), end: new Date(e.endDate).getTime() }))
    .filter((e) => !isNaN(e.start) && !isNaN(e.end))
    .sort((a, b) => a.start - b.start);

  const free: Array<{ start: Date; end: Date }> = [];
  let cursor = dayStart.getTime();

  for (const slot of busy) {
    if (slot.start > cursor && (slot.start - cursor) >= minMinutes * 60_000) {
      free.push({ start: new Date(cursor), end: new Date(slot.start) });
    }
    cursor = Math.max(cursor, slot.end);
  }

  if (dayEnd.getTime() > cursor && (dayEnd.getTime() - cursor) >= minMinutes * 60_000) {
    free.push({ start: new Date(cursor), end: dayEnd });
  }

  return free;
}

function formatAppleScriptDate(d: Date): string {
  // AppleScript date format depends on locale, use a parseable format
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }) + ` ${d.toLocaleTimeString('en-US', { hour12: true })}`;
}

function escapeAS(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeAppleScript(script: string): string {
  return script.replace(/'/g, "'\\''");
}
