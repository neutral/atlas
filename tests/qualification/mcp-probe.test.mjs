import test from 'node:test';
import assert from 'node:assert/strict';
import { probeMcp } from './mcp-probe.mjs';

const initialized = { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'probe-fixture', version: '1' } } };
const tool = { jsonrpc: '2.0', id: 2, result: { structuredContent: { selected: [{ point: { id: 'note' } }] } } };
test('MCP qualification rejects a clean exit without validated responses', async () => {
  await assert.rejects(probeMcp(process.execPath, ['-e', 'process.stdin.resume();process.stdin.once("data",()=>process.exit(0));']), /initialize=false/);
  const code = `process.stdin.resume();process.stdin.once('data',()=>{console.log(${JSON.stringify(JSON.stringify(initialized))});process.exit(0)});`;
  await assert.rejects(probeMcp(process.execPath, ['-e', code]), /tool=false|EPIPE/);
});
test('MCP qualification requires the initialize response and exact tool result', async () => {
  const code = `let pending='';process.stdin.on('data',bytes=>{pending+=bytes;let newline;while((newline=pending.indexOf('\\n'))>=0){const input=JSON.parse(pending.slice(0,newline));pending=pending.slice(newline+1);if(input.id===1)console.log(${JSON.stringify(JSON.stringify(initialized))});if(input.id===2)console.log(${JSON.stringify(JSON.stringify(tool))});}});`;
  assert.equal((await probeMcp(process.execPath, ['-e', code])).toolValidated, true);
});
