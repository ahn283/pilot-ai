export type SafetyLevel = 'safe' | 'moderate' | 'dangerous';

/**
 * Classifies the risk level of a task plan.
 */

const DANGEROUS_PATTERNS = [
  /\bgit\s+push\b/,
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\brm\s+(-[a-zA-Z]*r|-[a-zA-Z]*f)/,   // rm -r, rm -f, rm -rf
  /\bdrop\s+(table|database)\b/i,
  /\btruncate\s+table\b/i,
  /\bformat\s/,
  /\bdeploy\b/,
  /\bnpm\s+publish\b/,
  /\bsend\s*(email|mail|message)\b/i,
  /\bsubmit\s*(form)\b/i,
];

const MODERATE_PATTERNS = [
  /\bgit\s+commit\b/,
  /\bgit\s+merge\b/,
  /\bgit\s+checkout\b/,
  /\bnpm\s+install\b/,
  /\bmkdir\b/,
  /\btouch\b/,
  /\bcp\b/,
  /\bmv\b/,
  /\bwrite\b/i,
  /\bcreate\b/i,
  /\bmodify\b/i,
  /\bedit\b/i,
];

export function classifySafety(action: string): SafetyLevel {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(action)) {
      return 'dangerous';
    }
  }

  for (const pattern of MODERATE_PATTERNS) {
    if (pattern.test(action)) {
      return 'moderate';
    }
  }

  return 'safe';
}

/**
 * Manages pending approval state.
 */
export interface PendingApproval {
  taskId: string;
  action: string;
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ApprovalManager {
  private pending = new Map<string, PendingApproval>();

  /**
   * Requests approval and waits for approve/reject/timeout.
   */
  requestApproval(taskId: string, action: string, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(taskId);
        resolve(false); // Timeout -> treated as rejection
      }, timeoutMs);

      this.pending.set(taskId, { taskId, action, resolve, timer });
    });
  }

  /**
   * Handles a user's approve/reject response.
   */
  handleResponse(taskId: string, approved: boolean): boolean {
    const entry = this.pending.get(taskId);
    if (!entry) return false;

    clearTimeout(entry.timer);
    this.pending.delete(taskId);
    entry.resolve(approved);
    return true;
  }

  hasPending(taskId: string): boolean {
    return this.pending.has(taskId);
  }

  getPendingCount(): number {
    return this.pending.size;
  }
}
