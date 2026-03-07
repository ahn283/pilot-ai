import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecuteShell = vi.fn();
vi.mock('../../src/tools/shell.js', () => ({
  executeShell: (...args: unknown[]) => mockExecuteShell(...args),
}));

const {
  listEvents,
  getTodayEvents,
  createEvent,
  deleteEvent,
  findFreeTime,
} = await import('../../src/tools/calendar.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listEvents', () => {
  it('parses AppleScript calendar output', async () => {
    mockExecuteShell.mockResolvedValue({
      exitCode: 0,
      stdout: 'Work | Team Standup | Monday, March 7, 2026 9:00 AM | Monday, March 7, 2026 9:30 AM\nPersonal | Lunch | Monday, March 7, 2026 12:00 PM | Monday, March 7, 2026 1:00 PM',
      stderr: '',
    });

    const events = await listEvents(new Date(2026, 2, 7), new Date(2026, 2, 7, 23, 59));
    expect(events).toHaveLength(2);
    expect(events[0].title).toBe('Team Standup');
    expect(events[0].calendar).toBe('Work');
    expect(events[1].title).toBe('Lunch');
  });

  it('returns empty on failure', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'error' });
    const events = await listEvents(new Date(), new Date());
    expect(events).toHaveLength(0);
  });
});

describe('createEvent', () => {
  it('creates event via AppleScript', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await createEvent({
      title: 'Meeting',
      startDate: 'Monday, March 7, 2026 2:00 PM',
      endDate: 'Monday, March 7, 2026 3:00 PM',
    });
    expect(mockExecuteShell).toHaveBeenCalledWith(
      expect.stringContaining('make new event'),
    );
  });

  it('throws on failure', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'Calendar not found' });
    await expect(createEvent({
      title: 'Bad',
      startDate: 'now',
      endDate: 'later',
    })).rejects.toThrow('Failed to create event');
  });
});

describe('deleteEvent', () => {
  it('returns true when event deleted', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: 'deleted', stderr: '' });
    const result = await deleteEvent('Meeting', new Date(2026, 2, 7));
    expect(result).toBe(true);
  });

  it('returns false when event not found', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: 'not found', stderr: '' });
    const result = await deleteEvent('Missing', new Date());
    expect(result).toBe(false);
  });
});

describe('findFreeTime', () => {
  it('finds gaps between events', async () => {
    // Mock listEvents through executeShell
    mockExecuteShell.mockResolvedValue({
      exitCode: 0,
      stdout: [
        `Work | Meeting | ${new Date(2026, 2, 7, 10, 0).toString()} | ${new Date(2026, 2, 7, 11, 0).toString()}`,
        `Work | Lunch | ${new Date(2026, 2, 7, 12, 0).toString()} | ${new Date(2026, 2, 7, 13, 0).toString()}`,
      ].join('\n'),
      stderr: '',
    });

    const free = await findFreeTime(new Date(2026, 2, 7));
    expect(free.length).toBeGreaterThan(0);
  });
});
