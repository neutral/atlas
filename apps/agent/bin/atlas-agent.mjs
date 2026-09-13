#!/usr/bin/env node
import { run } from '../src/agent-stdio.mjs';
try { process.exit(await run()); }
catch (error) {
  process.stderr.write(`${JSON.stringify({ error: { code: typeof error?.code === 'string' ? error.code : 'atlas.agent.launch-failed', message: error instanceof Error ? error.message : String(error) } })}\n`);
  process.exit(2);
}
