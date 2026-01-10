import { config as dotenvConfig } from 'dotenv';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import auth from 'basic-auth';

// Load .env from repository root (two levels up)
dotenvConfig({ path: path.resolve(__dirname, '../../.env') });

const app = express();

// Support both new (UI_*) and legacy (PORT/HOST) env var names
const port = Number.parseInt(process.env.UI_PORT ?? process.env.PORT ?? '4174', 10);
const host = process.env.UI_BIND_HOST ?? '0.0.0.0';
const signetHost = process.env.SIGNET_HOST ?? 'localhost';
const signetPort = process.env.SIGNET_PORT ?? '3000';
const daemonUrl = process.env.DAEMON_URL ?? `http://${signetHost}:${signetPort}`;

// Basic auth configuration (disabled by default)
const authUsername = process.env.UI_AUTH_USERNAME;
const authPassword = process.env.UI_AUTH_PASSWORD;
const isAuthEnabled = authUsername && authPassword;

// Load API token from daemon config file
let apiToken = null;
const configPath = process.env.SIGNET_CONFIG ?? path.join(homedir(), '.signet', 'config.json');
if (existsSync(configPath)) {
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    apiToken = config.apiToken;
    if (apiToken) {
      console.log('✓ Loaded API token from daemon config');
    }
  } catch (err) {
    console.warn('⚠️  Failed to load daemon config:', err.message);
  }
} else {
  console.warn('⚠️  Daemon config not found at', configPath);
}

// Shared error handler for proxies
const onProxyError = (err, req, res) => {
  if (res.headersSent) return;
  res.status(502).json({
    ok: false,
    error: `Proxy error: ${err instanceof Error ? err.message : 'unknown error'}`
  });
};

// API paths to proxy
const apiPaths = [
  '/requests',
  '/register',
  '/connection',
  '/connections',
  '/relays',
  '/keys',
  '/apps',
  '/dashboard',
  '/health',
  '/tokens',
  '/policies',
  '/csrf-token',
  '/nostrconnect',
  '/dead-man-switch'
];

// SSE proxy for /events endpoint (no timeout, streaming)
const sseProxy = createProxyMiddleware({
  target: daemonUrl,
  changeOrigin: true,
  proxyTimeout: 0,
  timeout: 0,
  pathFilter: '/events',
  on: {
    proxyReq(proxyReq) {
      proxyReq.setHeader('Accept', 'text/event-stream');
      proxyReq.setHeader('Cache-Control', 'no-cache');
      proxyReq.setHeader('Connection', 'keep-alive');
      if (apiToken) {
        proxyReq.setHeader('X-API-Token', apiToken);
      }
    },
    proxyRes(proxyRes) {
      proxyRes.headers['x-accel-buffering'] = 'no';
      proxyRes.headers['cache-control'] = 'no-cache, no-transform';
    },
    error: onProxyError
  }
});

// API proxy for standard endpoints
const apiProxy = createProxyMiddleware({
  target: daemonUrl,
  changeOrigin: true,
  proxyTimeout: 10_000,
  pathFilter: apiPaths,
  on: {
    proxyReq(proxyReq) {
      if (apiToken) {
        proxyReq.setHeader('X-API-Token', apiToken);
      }
    },
    error: onProxyError
  }
});

// Basic authentication middleware
if (isAuthEnabled) {
  app.use((req, res, next) => {
    const credentials = auth(req);

    if (!credentials || credentials.name !== authUsername || credentials.pass !== authPassword) {
      res.set('WWW-Authenticate', 'Basic realm="Signet UI"');
      return res.status(401).send('Authentication required');
    }

    next();
  });
}

// Mount proxies at root - pathFilter handles routing
app.use(sseProxy);
app.use(apiProxy);

// Serve static files
const distDir = path.join(__dirname, 'dist');
app.use(express.static(distDir));

// SPA fallback - serve index.html for all other routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(port, host, () => {
  const authStatus = isAuthEnabled ? ' [Basic Auth Enabled]' : '';
  console.log(`Signet UI listening on http://${host}:${port} (proxying ${daemonUrl})${authStatus}`);
});
