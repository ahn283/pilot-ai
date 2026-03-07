import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initLinear,
  resetLinear,
  isLinearInitialized,
  createIssue,
  getIssue,
  listMyIssues,
  updateIssueState,
  listTeams,
} from '../../src/tools/linear.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
  resetLinear();
});

function mockGraphQL(data: unknown) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data }),
  });
}

describe('initialization', () => {
  it('initializes and checks status', () => {
    expect(isLinearInitialized()).toBe(false);
    initLinear('lin_test');
    expect(isLinearInitialized()).toBe(true);
  });

  it('throws when not initialized', async () => {
    await expect(listTeams()).rejects.toThrow('Linear not initialized');
  });
});

describe('issues', () => {
  beforeEach(() => initLinear('lin_test'));

  it('creates an issue', async () => {
    mockGraphQL({
      issueCreate: {
        issue: { id: 'i1', identifier: 'ENG-1', title: 'Bug', state: { name: 'Todo' }, priority: 2, url: 'https://linear.app/i1' },
      },
    });

    const issue = await createIssue({ teamId: 't1', title: 'Bug', priority: 2 });
    expect(issue.identifier).toBe('ENG-1');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.linear.app/graphql',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('gets an issue', async () => {
    mockGraphQL({
      issue: { id: 'i1', identifier: 'ENG-1', title: 'Bug', state: { name: 'In Progress' }, priority: 1, url: '' },
    });
    const issue = await getIssue('i1');
    expect(issue.state.name).toBe('In Progress');
  });

  it('lists my issues', async () => {
    mockGraphQL({
      viewer: { assignedIssues: { nodes: [{ id: 'i1', identifier: 'ENG-1', title: 'Task', state: { name: 'Todo' }, priority: 3, url: '' }] } },
    });
    const issues = await listMyIssues();
    expect(issues).toHaveLength(1);
  });

  it('updates issue state', async () => {
    mockGraphQL({ issueUpdate: { issue: { id: 'i1' } } });
    await updateIssueState('i1', 'state-done');
    expect(mockFetch).toHaveBeenCalled();
  });
});

describe('teams', () => {
  beforeEach(() => initLinear('lin_test'));

  it('lists teams', async () => {
    mockGraphQL({ teams: { nodes: [{ id: 't1', name: 'Engineering', key: 'ENG' }] } });
    const teams = await listTeams();
    expect(teams[0].key).toBe('ENG');
  });
});

describe('error handling', () => {
  beforeEach(() => initLinear('lin_test'));

  it('handles API errors', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' });
    await expect(listTeams()).rejects.toThrow('Linear API error: 401');
  });

  it('handles GraphQL errors', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errors: [{ message: 'Not found' }] }),
    });
    await expect(getIssue('bad')).rejects.toThrow('Linear GraphQL error: Not found');
  });
});
