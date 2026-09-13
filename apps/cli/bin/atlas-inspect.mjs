#!/usr/bin/env node
import process from 'node:process';
import { run } from '../src/inspect-cli.mjs';

try {
  process.exitCode = run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
