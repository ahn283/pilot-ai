/**
 * Linear API client using GraphQL.
 * Requires a Linear API key (personal or OAuth).
 */

let apiKey: string | null = null;

const LINEAR_API = 'https://api.linear.app/graphql';

export function initLinear(key: string): void {
  apiKey = key;
}

export function isLinearInitialized(): boolean {
  return apiKey !== null;
}

export function resetLinear(): void {
  apiKey = null;
}

async function query<T>(gql: string, variables?: Record<string, unknown>): Promise<T> {
  if (!apiKey) throw new Error('Linear not initialized. Call initLinear() first.');

  const response = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey,
    },
    body: JSON.stringify({ query: gql, variables }),
  });

  if (!response.ok) {
    throw new Error(`Linear API error: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(`Linear GraphQL error: ${json.errors[0].message}`);
  }
  return json.data as T;
}

// --- Issues ---

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  state: { name: string };
  priority: number;
  assignee?: { name: string };
  url: string;
}

export async function createIssue(params: {
  teamId: string;
  title: string;
  description?: string;
  priority?: number;
  assigneeId?: string;
}): Promise<LinearIssue> {
  const data = await query<{ issueCreate: { issue: LinearIssue } }>(
    `mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        issue { id identifier title state { name } priority url }
      }
    }`,
    {
      input: {
        teamId: params.teamId,
        title: params.title,
        description: params.description,
        priority: params.priority,
        assigneeId: params.assigneeId,
      },
    },
  );
  return data.issueCreate.issue;
}

export async function getIssue(issueId: string): Promise<LinearIssue> {
  const data = await query<{ issue: LinearIssue }>(
    `query($id: String!) {
      issue(id: $id) { id identifier title state { name } priority assignee { name } url }
    }`,
    { id: issueId },
  );
  return data.issue;
}

export async function listMyIssues(limit: number = 20): Promise<LinearIssue[]> {
  const data = await query<{ viewer: { assignedIssues: { nodes: LinearIssue[] } } }>(
    `query($limit: Int!) {
      viewer {
        assignedIssues(first: $limit, filter: { state: { type: { nin: ["completed", "canceled"] } } }) {
          nodes { id identifier title state { name } priority url }
        }
      }
    }`,
    { limit },
  );
  return data.viewer.assignedIssues.nodes;
}

export async function updateIssueState(issueId: string, stateId: string): Promise<void> {
  await query(
    `mutation($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) {
        issue { id }
      }
    }`,
    { id: issueId, stateId },
  );
}

export async function listTeams(): Promise<Array<{ id: string; name: string; key: string }>> {
  const data = await query<{ teams: { nodes: Array<{ id: string; name: string; key: string }> } }>(
    `query { teams { nodes { id name key } } }`,
  );
  return data.teams.nodes;
}

export async function listStates(teamId: string): Promise<Array<{ id: string; name: string; type: string }>> {
  const data = await query<{ workflowStates: { nodes: Array<{ id: string; name: string; type: string }> } }>(
    `query($teamId: ID!) {
      workflowStates(filter: { team: { id: { eq: $teamId } } }) {
        nodes { id name type }
      }
    }`,
    { teamId },
  );
  return data.workflowStates.nodes;
}
