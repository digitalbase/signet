import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';

// Load .env from repository root (three levels up from this file's location)
dotenvConfig({ path: resolve(__dirname, '../../../../.env') });

import 'websocket-polyfill';
import { runDaemon } from './run.js';
import type { DaemonBootstrapConfig } from './types.js';

process.on('message', (payload: DaemonBootstrapConfig) => {
    runDaemon(payload);
});
