#!/usr/bin/env node
import { errorResult, run } from '../src/authoring-cli.mjs';
try { process.exitCode = await run(); }
catch (error) { console.error(JSON.stringify(errorResult(error))); process.exitCode = 2; }
