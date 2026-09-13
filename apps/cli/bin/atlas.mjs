#!/usr/bin/env node
import { run } from '../src/atlas-cli.mjs';
try { process.exitCode = await run(); }
catch (error) {
  process.stderr.write(`${JSON.stringify({ error: { code: error.code ?? 'atlas.launch.failed', message: error.message } })}\n`);
  process.exitCode = 2;
}
