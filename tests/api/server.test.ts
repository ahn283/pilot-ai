import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { ApiServer } from '../../src/api/server.js';

const TOKEN = 'test-token-abc123';
let server: ApiServer;

function request(
  method: string,
  path: string,
  opts?: { body?: unknown; token?: string },
): Promise<{ status: number; data: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts?.token) headers['Authorization'] = `Bearer ${opts.token}`;

    const req = http.request(
      { hostname: '127.0.0.1', port: server.getPort(), path, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          resolve({ status: res.statusCode!, data: JSON.parse(raw) });
        });
      },
    );
    req.on('error', reject);
    if (opts?.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

beforeEach(async () => {
  server = new ApiServer(TOKEN, 0); // port 0 = random available port
  server.onCommand(async (req) => ({ ok: true, taskId: `task-${req.command}` }));
  await server.start();
  // Get actual port from the underlying server
  const addr = (server as unknown as { server: http.Server }).server.address() as { port: number };
  // Override port for test requests
  Object.defineProperty(server, 'port', { value: addr.port, writable: false });
});

afterEach(async () => {
  await server.stop();
});

describe('ApiServer', () => {
  it('health check returns component statuses and metrics', async () => {
    const { status, data } = await request('GET', '/health');
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.status).toBe('running');
    expect(data.components).toBeDefined();
    expect((data.components as Record<string, string>).claude).toBe('healthy');
    expect(data.metrics).toBeDefined();
    expect(typeof data.uptime).toBe('number');
  });

  it('POST /api/command with valid token', async () => {
    const { status, data } = await request('POST', '/api/command', {
      token: TOKEN,
      body: { command: 'run tests', project: 'api' },
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.taskId).toBe('task-run tests');
  });

  it('rejects missing auth', async () => {
    const { status } = await request('POST', '/api/command', {
      body: { command: 'test' },
    });
    expect(status).toBe(401);
  });

  it('rejects wrong token', async () => {
    const { status } = await request('POST', '/api/command', {
      token: 'wrong-token',
      body: { command: 'test' },
    });
    expect(status).toBe(401);
  });

  it('rejects missing command field', async () => {
    const { status } = await request('POST', '/api/command', {
      token: TOKEN,
      body: { project: 'api' },
    });
    expect(status).toBe(400);
  });

  it('rejects invalid JSON', async () => {
    return new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: server.getPort(),
          path: '/api/command',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TOKEN}`,
          },
        },
        (res) => {
          expect(res.statusCode).toBe(400);
          res.resume();
          res.on('end', () => resolve());
        },
      );
      req.on('error', reject);
      req.write('not json{{{');
      req.end();
    });
  });

  it('returns 404 for unknown routes', async () => {
    const { status } = await request('GET', '/unknown');
    expect(status).toBe(404);
  });

  it('generates random tokens', () => {
    const t1 = ApiServer.generateToken();
    const t2 = ApiServer.generateToken();
    expect(t1).toHaveLength(64);
    expect(t1).not.toBe(t2);
  });

  it('rate limits excessive requests', async () => {
    // Send 31 requests rapidly (limit is 30/min)
    const results: number[] = [];
    for (let i = 0; i < 32; i++) {
      const { status } = await request('POST', '/api/command', {
        token: TOKEN,
        body: { command: `req-${i}` },
      });
      results.push(status);
    }
    expect(results.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});
