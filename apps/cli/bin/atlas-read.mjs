#!/usr/bin/env node
import process from 'node:process';
import { errorResult, run } from '../src/read-cli.mjs';

try {
  process.exitCode = await run();
} catch (error) {
  console.error(JSON.stringify(errorResult(error)));
  process.exitCode = 2;
}
