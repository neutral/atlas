import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

export async function probeMcp(command, args, { cwd, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let pending = '', stderr = '', bytesRead = 0, initialized = false, tool = false;
    const fail = error => { clearTimeout(timer); child.kill(); reject(error); };
    const timer = setTimeout(() => fail(new Error('Installed MCP timed out.')), timeoutMs);
    const send = message => child.stdin.write(JSON.stringify(message) + '\n');
    child.once('error', fail);
    child.stdin.on('error', fail);
    child.stderr.on('data', bytes => {
      stderr += bytes;
      if (Buffer.byteLength(stderr) > 1024 * 1024) fail(new Error('Installed MCP stderr exceeds its bound.'));
    });
    child.stdout.on('data', bytes => {
      try {
        bytesRead += bytes.length;
        assert.ok(bytesRead <= 4 * 1024 * 1024, 'Installed MCP output exceeds its bound.');
        pending += bytes;
        let newline;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const message = JSON.parse(pending.slice(0, newline)); pending = pending.slice(newline + 1);
          assert.equal(message.jsonrpc, '2.0');
          assert.equal(message.error, undefined);
          if (message.id === 1) {
            assert.equal(initialized, false, 'Duplicate initialize response.');
            assert.equal(message.result.protocolVersion, '2025-11-25');
            assert.ok(message.result.capabilities.tools);
            assert.equal(typeof message.result.serverInfo.name, 'string');
            initialized = true;
            send({ jsonrpc: '2.0', method: 'notifications/initialized' });
            send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'atlas_route', arguments: { point: 'note' } } });
          } else if (message.id === 2) {
            assert.ok(initialized && !tool, 'Unexpected tool response.');
            assert.notEqual(message.result.isError, true);
            assert.equal(message.result.structuredContent.selected[0].point.id, 'note');
            tool = true;
            child.stdin.end();
          } else throw new Error('Unexpected installed MCP response.');
        }
      } catch (error) { fail(error); }
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0 && !stderr && !pending && initialized && tool) resolve({ protocol: '2025-11-25', tool: 'atlas_route', initialized, toolValidated: tool });
      else reject(new Error(`Installed MCP failed: exit=${code}, initialize=${initialized}, tool=${tool}, stderr=${stderr}`));
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'installed-qualification', version: '1' } } });
  });
}
