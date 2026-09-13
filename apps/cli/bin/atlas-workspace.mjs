#!/usr/bin/env node
import { errorResult, run } from '../src/workspace-cli.mjs';

try { process.exitCode = run(); }
catch (error) {
  console.error(JSON.stringify(errorResult(error)));
  process.exitCode = 2;
}
