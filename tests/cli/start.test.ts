import { describe, it, expect } from 'vitest';
import { buildPlist } from '../../src/cli/start.js';

describe('buildPlist', () => {
  it('올바른 plist XML을 생성한다', () => {
    const plist = buildPlist('/usr/local/bin/node', '/path/to/index.js', '/tmp/logs');

    expect(plist).toContain('com.pilot-ai.agent');
    expect(plist).toContain('/usr/local/bin/node');
    expect(plist).toContain('/path/to/index.js');
    expect(plist).toContain('daemon');
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain('<true/>');
    expect(plist).toContain('/tmp/logs/agent.log');
    expect(plist).toContain('/tmp/logs/agent-error.log');
  });

  it('PATH 환경변수를 포함한다', () => {
    const plist = buildPlist('/usr/bin/node', '/script.js', '/logs');
    expect(plist).toContain('/opt/homebrew/bin');
  });
});
