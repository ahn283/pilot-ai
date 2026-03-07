import http from 'node:http';
import crypto from 'node:crypto';

export interface CommandRequest {
  command: string;
  project?: string;
}

export interface CommandResponse {
  ok: boolean;
  taskId?: string;
  error?: string;
}

export type CommandHandler = (req: CommandRequest) => Promise<CommandResponse>;

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const DEFAULT_PORT = 3847;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

export class ApiServer {
  private server: http.Server | null = null;
  private token: string;
  private handler: CommandHandler | null = null;
  private port: number;
  private rateLimitMap: Map<string, RateLimitEntry> = new Map();

  constructor(token: string, port: number = DEFAULT_PORT) {
    this.token = token;
    this.port = port;
  }

  onCommand(handler: CommandHandler): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch(() => {
          this.sendJson(res, 500, { ok: false, error: 'Internal server error' });
        });
      });

      this.server.on('error', reject);
      // Bind to localhost only
      this.server.listen(this.port, '127.0.0.1', () => resolve());
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
    });
  }

  isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }

  getPort(): number {
    return this.port;
  }

  static generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': 'http://localhost',
        'Access-Control-Allow-Methods': 'POST, GET',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      });
      res.end();
      return;
    }

    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      this.sendJson(res, 200, { ok: true, status: 'running' });
      return;
    }

    // Command endpoint
    if (req.method === 'POST' && req.url === '/api/command') {
      await this.handleCommand(req, res);
      return;
    }

    this.sendJson(res, 404, { ok: false, error: 'Not found' });
  }

  private async handleCommand(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Auth check
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${this.token}`) {
      this.sendJson(res, 401, { ok: false, error: 'Unauthorized' });
      return;
    }

    // Rate limiting by remote address
    const ip = req.socket.remoteAddress ?? 'unknown';
    if (this.isRateLimited(ip)) {
      this.sendJson(res, 429, { ok: false, error: 'Rate limit exceeded' });
      return;
    }

    // Parse body
    const body = await this.readBody(req);
    if (!body) {
      this.sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
      return;
    }

    if (!body.command || typeof body.command !== 'string') {
      this.sendJson(res, 400, { ok: false, error: 'Missing "command" field' });
      return;
    }

    if (!this.handler) {
      this.sendJson(res, 503, { ok: false, error: 'No command handler registered' });
      return;
    }

    const result = await this.handler({
      command: body.command,
      project: typeof body.project === 'string' ? body.project : undefined,
    });

    this.sendJson(res, result.ok ? 200 : 500, result);
  }

  private isRateLimited(ip: string): boolean {
    const now = Date.now();
    const entry = this.rateLimitMap.get(ip);

    if (!entry || now >= entry.resetAt) {
      this.rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return false;
    }

    entry.count++;
    return entry.count > RATE_LIMIT_MAX;
  }

  private readBody(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf-8');
          resolve(JSON.parse(raw) as Record<string, unknown>);
        } catch {
          resolve(null);
        }
      });
      req.on('error', () => resolve(null));
    });
  }

  private sendJson(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}
