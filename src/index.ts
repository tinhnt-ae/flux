#!/usr/bin/env node
// Load .env early so env vars are available.
import dotenv from 'dotenv';
dotenv.config();

import { createProgram } from './cli/commands';
import { startInteractiveCli } from './cli/interactive';
import { getErrorMessage } from './utils/errors';

async function main(): Promise<void> {
  if (process.argv.length <= 2) {
    await startInteractiveCli();
    return;
  }

  createProgram().parse(process.argv);
}

main().catch((error: unknown) => {
  console.error(getErrorMessage(error, 'Unexpected failure'));
  process.exit(1);
});
