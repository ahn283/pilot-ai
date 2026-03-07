import { describe, it, expect } from 'vitest';
import { detectPermissionError } from '../../src/security/permissions.js';

describe('detectPermissionError', () => {
  it('detects Accessibility permission errors', () => {
    const result = detectPermissionError('osascript: not allowed assistive access');
    expect(result).toContain('Accessibility');
    expect(result).toContain('System Settings');
  });

  it('detects Screen Recording permission errors', () => {
    const result = detectPermissionError('screen capture not permitted for this process');
    expect(result).toContain('Screen Recording');
  });

  it('detects Automation/AppleEvents permission errors', () => {
    const result = detectPermissionError('Error: 1743 System Events got an error: not allowed');
    expect(result).toContain('Automation');
  });

  it('detects Full Disk Access (EPERM) errors', () => {
    const result = detectPermissionError('EPERM: operation not permitted, open /Library/Mail');
    expect(result).toContain('Full Disk Access');
  });

  it('detects cross-app data access errors', () => {
    const result = detectPermissionError('"node" would like to access data from other apps');
    expect(result).toContain('Automation');
  });

  it('detects Camera permission errors', () => {
    const result = detectPermissionError('AVFoundation camera access denied');
    expect(result).toContain('Camera');
  });

  it('detects Microphone permission errors', () => {
    const result = detectPermissionError('AVFoundation microphone access denied');
    expect(result).toContain('Microphone');
  });

  it('returns null for unrelated errors', () => {
    expect(detectPermissionError('ENOENT: file not found')).toBeNull();
    expect(detectPermissionError('Claude CLI timeout')).toBeNull();
    expect(detectPermissionError('Network error')).toBeNull();
  });
});
