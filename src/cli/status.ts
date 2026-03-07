import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PLIST_NAME = 'com.pilot-ai.agent';

export interface AgentStatus {
  running: boolean;
  pid: number | null;
  lastExitStatus: number | null;
}

export async function getAgentStatus(): Promise<AgentStatus> {
  try {
    const { stdout } = await execFileAsync('launchctl', ['list']);
    const lines = stdout.split('\n');
    const agentLine = lines.find((l) => l.includes(PLIST_NAME));

    if (!agentLine) {
      return { running: false, pid: null, lastExitStatus: null };
    }

    // launchctl list format: PID\tStatus\tLabel
    const parts = agentLine.trim().split('\t');
    const pid = parts[0] === '-' ? null : parseInt(parts[0], 10);
    const exitStatus = parts[1] === '-' ? null : parseInt(parts[1], 10);

    return {
      running: pid !== null,
      pid,
      lastExitStatus: exitStatus,
    };
  } catch {
    return { running: false, pid: null, lastExitStatus: null };
  }
}

export async function runStatus(): Promise<void> {
  const status = await getAgentStatus();

  if (status.running) {
    console.log(`에이전트 상태: 실행 중 (PID: ${status.pid})`);
  } else {
    console.log('에이전트 상태: 중지됨');
    if (status.lastExitStatus !== null) {
      console.log(`  마지막 종료 코드: ${status.lastExitStatus}`);
    }
  }
}
