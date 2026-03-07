export type SafetyLevel = 'safe' | 'moderate' | 'dangerous';

/**
 * 작업 계획의 위험도를 분류한다.
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
 * 승인 대기 상태를 관리한다.
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
   * 승인을 요청하고, 승인/거부/타임아웃까지 대기한다.
   */
  requestApproval(taskId: string, action: string, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(taskId);
        resolve(false); // 타임아웃 → 거부 처리
      }, timeoutMs);

      this.pending.set(taskId, { taskId, action, resolve, timer });
    });
  }

  /**
   * 사용자의 승인/거부 응답을 처리한다.
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
