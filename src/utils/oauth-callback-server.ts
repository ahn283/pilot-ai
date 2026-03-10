/**
 * Local HTTP server for receiving OAuth2 authorization callbacks.
 * Uses loopback IP (127.0.0.1) as recommended by RFC 8252 for native apps.
 * Google treats loopback redirect URIs as port-agnostic.
 */
import http from 'node:http';

export interface OAuthCallbackResult {
  code: string;
  state?: string;
}

export interface OAuthCallbackServer {
  /** The assigned port number */
  port: number;
  /** The full redirect URI (e.g. http://127.0.0.1:12345/callback) */
  redirectUri: string;
  /** Waits for the OAuth callback and returns the authorization code */
  waitForCode(): Promise<OAuthCallbackResult>;
  /** Shuts down the server immediately */
  close(): void;
}

const SUCCESS_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Authentication Successful</title></head>
<body style="font-family:system-ui;text-align:center;padding:60px">
<h1>✓ Authentication Successful</h1>
<p>You can close this tab and return to the terminal.</p>
</body></html>`;

const ERROR_HTML = (error: string) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Authentication Failed</title></head>
<body style="font-family:system-ui;text-align:center;padding:60px">
<h1>✗ Authentication Failed</h1>
<p>Error: ${error}</p>
<p>Please try again in the terminal.</p>
</body></html>`;

/**
 * Starts a local HTTP server on 127.0.0.1 with a random port to receive
 * the OAuth2 authorization callback.
 *
 * @param timeoutMs - Timeout in milliseconds (default: 120000)
 */
export async function startOAuthCallbackServer(timeoutMs = 120_000): Promise<OAuthCallbackServer> {
  return new Promise((resolveServer, rejectServer) => {
    let codeResolve: (result: OAuthCallbackResult) => void;
    let codeReject: (error: Error) => void;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const codePromise = new Promise<OAuthCallbackResult>((resolve, reject) => {
      codeResolve = resolve;
      codeReject = reject;
    });
    // Prevent unhandled rejection warnings — callers handle via waitForCode()
    codePromise.catch(() => {});

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1`);

      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(ERROR_HTML(error));
        cleanup();
        codeReject!(new Error(`OAuth error: ${error}`));
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(ERROR_HTML('No authorization code received'));
        cleanup();
        codeReject!(new Error('No authorization code in callback'));
        return;
      }

      const state = url.searchParams.get('state') ?? undefined;

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(SUCCESS_HTML);
      cleanup();
      codeResolve!({ code, state });
    });

    function cleanup(): void {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      server.close();
    }

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        rejectServer(new Error('Failed to get server address'));
        return;
      }

      const port = addr.port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;

      timeoutHandle = setTimeout(() => {
        cleanup();
        codeReject!(new Error(`OAuth callback timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      resolveServer({
        port,
        redirectUri,
        waitForCode: () => codePromise,
        close: () => cleanup(),
      });
    });

    server.on('error', (err) => {
      rejectServer(err);
    });
  });
}
