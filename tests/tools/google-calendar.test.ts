import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock google-auth
vi.mock('../../src/tools/google-auth.js', () => ({
  getGoogleAccessToken: vi.fn().mockResolvedValue('mock-access-token'),
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  listCalendars,
  listEvents,
  getTodayEvents,
  createEvent,
  deleteEvent,
  findFreeTime,
} from '../../src/tools/google-calendar.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('google-calendar', () => {
  it('listCalendars calls Calendar API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: [{ id: 'primary', summary: 'My Calendar', primary: true }] }),
    });

    const calendars = await listCalendars();
    expect(calendars).toHaveLength(1);
    expect(calendars[0].summary).toBe('My Calendar');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('calendar/v3');
  });

  it('listEvents queries with time range', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        items: [{
          id: 'evt1',
          summary: 'Team Meeting',
          start: { dateTime: '2026-03-08T10:00:00Z' },
          end: { dateTime: '2026-03-08T11:00:00Z' },
        }],
      }),
    });

    const start = new Date('2026-03-08T00:00:00Z');
    const end = new Date('2026-03-08T23:59:59Z');
    const events = await listEvents(start, end);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe('Team Meeting');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('timeMin');
    expect(url).toContain('timeMax');
  });

  it('getTodayEvents uses current date', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    });

    const events = await getTodayEvents();
    expect(events).toEqual([]);
  });

  it('createEvent sends POST request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        id: 'new-evt',
        summary: 'New Meeting',
        start: { dateTime: '2026-03-09T14:00:00Z' },
        end: { dateTime: '2026-03-09T15:00:00Z' },
      }),
    });

    const event = await createEvent({
      summary: 'New Meeting',
      startDateTime: '2026-03-09T14:00:00Z',
      endDateTime: '2026-03-09T15:00:00Z',
    });
    expect(event.summary).toBe('New Meeting');
    expect(mockFetch.mock.calls[0][1]?.method).toBe('POST');
  });

  it('deleteEvent sends DELETE request', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

    await deleteEvent('evt-to-delete');
    expect(mockFetch.mock.calls[0][1]?.method).toBe('DELETE');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('evt-to-delete');
  });

  it('findFreeTime returns gaps between events', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        items: [
          {
            id: 'e1',
            summary: 'Morning',
            start: { dateTime: '2026-03-08T09:00:00' },
            end: { dateTime: '2026-03-08T10:00:00' },
          },
          {
            id: 'e2',
            summary: 'Afternoon',
            start: { dateTime: '2026-03-08T14:00:00' },
            end: { dateTime: '2026-03-08T15:00:00' },
          },
        ],
      }),
    });

    const date = new Date('2026-03-08T12:00:00');
    const free = await findFreeTime(date, 30);
    expect(free.length).toBeGreaterThan(0);
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    await expect(listCalendars()).rejects.toThrow('Google Calendar API error (401)');
  });
});
