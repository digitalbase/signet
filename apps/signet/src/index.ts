#!/usr/bin/env node
import { resolve } from 'path';
import 'websocket-polyfill';
import { homedir } from 'os';
import { join } from 'path';

// Load .env from repository root (two levels up from this file's location) in development
// In production (NODE_ENV=production), dotenv may not be installed
if (process.env.NODE_ENV !== 'production') {
  try {
    // Use require for synchronous loading to avoid top-level await
    const dotenv = require('dotenv');
    dotenv.config({ path: resolve(__dirname, '../../../.env') });
  } catch {
    // dotenv not available, skip .env loading (production mode)
  }
}

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { addKey } from './commands/add.js';
import { runStart } from './commands/start.js';

const defaultConfigPath = join(homedir(), '.signet-config', 'signet.json');

async function main() {
    await yargs(hideBin(process.argv))
        .scriptName('signet')
        .option('config', {
            alias: 'c',
            type: 'string',
            default: defaultConfigPath,
            describe: 'Path to the configuration file',
        })
        .command(
            'add',
            'Encrypt and store an nsec',
            (command) =>
                command.option('name', {
                    alias: 'n',
                    type: 'string',
                    demandOption: true,
                    describe: 'Key label to store the nsec under',
                }),
            async (argv) => {
                await addKey({
                    configPath: argv.config as string,
                    keyName: argv.name as string,
                });
            }
        )
        .command(
            'start',
            'Start the Signet daemon',
            (command) =>
                command
                    .option('key', {
                        type: 'string',
                        array: true,
                        describe: 'Key label to unlock at startup',
                    })
                    .option('verbose', {
                        alias: 'v',
                        type: 'boolean',
                        default: false,
                        describe: 'Enable verbose logging',
                    }),
            async (argv) => {
                await runStart({
                    configPath: argv.config as string,
                    keyNames: argv.key ? (argv.key as string[]) : undefined,
                    verbose: Boolean(argv.verbose),
                });
            }
        )
        .demandCommand(1, 'Specify a command to run.')
        .strict()
        .help()
        .parse();
}

main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
});
