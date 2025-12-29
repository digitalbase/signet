import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Support both new (UI_*) and legacy (PORT/HOST) env var names
const port = Number.parseInt(process.env.UI_PORT ?? process.env.PORT ?? '4174', 10);
const host = process.env.UI_HOST ?? process.env.HOST ?? '0.0.0.0';
const daemonUrl = process.env.DAEMON_URL ?? 'http://localhost:3000';

// SSE-specific proxy for /events endpoint (no timeout, streaming)
const sseProxy = createProxyMiddleware({
  target: daemonUrl,
  changeOrigin: true,
  ws: false,
  // No timeout for SSE connections
  proxyTimeout: 0,
  timeout: 0,
  pathFilter: ['/events'],
  onProxyReq(proxyReq, req, res) {
    // Ensure headers are set correctly for SSE
    proxyReq.setHeader('Accept', 'text/event-stream');
    proxyReq.setHeader('Cache-Control', 'no-cache');
    proxyReq.setHeader('Connection', 'keep-alive');
  },
  onProxyRes(proxyRes, req, res) {
    // Disable buffering for SSE
    proxyRes.headers['x-accel-buffering'] = 'no';
    proxyRes.headers['cache-control'] = 'no-cache, no-transform';
  },
  onError(err, req, res) {
    console.error('SSE proxy error:', err.message);
    if (res.headersSent) {
      return;
    }
    res.status(502).json({
      ok: false,
      error: `SSE proxy error: ${err instanceof Error ? err.message : 'unknown error'}`
    });
  }
});

// API proxy for other endpoints
const apiProxy = createProxyMiddleware({
  target: daemonUrl,
  changeOrigin: true,
  ws: false,
  proxyTimeout: 10_000,
  pathFilter: ['/requests', '/register', '/connection', '/relays', '/keys', '/apps', '/dashboard', '/health', '/tokens', '/policies', '/csrf-token'],
  onError(err, req, res) {
    if (res.headersSent) {
      return;
    }

    res
      .status(502)
      .json({
        ok: false,
        error: `Proxy error: ${err instanceof Error ? err.message : 'unknown error'}`
      });
  }
});

// SSE proxy must come first (more specific route)
app.use(sseProxy);
app.use(apiProxy);

const distDir = path.join(__dirname, 'dist');
app.use(express.static(distDir));

app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(port, host, () => {
  console.log(`Signet UI listening on http://${host}:${port} (proxying ${daemonUrl})`);
});
