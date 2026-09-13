import { dev } from 'astro';
const args = process.argv.slice(2);
const port = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 4321;
const host = args.includes('--host') ? args[args.indexOf('--host') + 1] : '127.0.0.1';
let server = await dev({ root: process.cwd(), server: { port, host } });
let stopped = false;
async function stop() {
  if (stopped) return;
  stopped = true;
  await refreshing;
  await server.stop();
  if (process.connected) process.disconnect?.();
  process.off('SIGINT', stop); process.off('SIGTERM', stop);
}
let refreshing = Promise.resolve();
process.on('message', message => {
  if (message && typeof message === 'object' && 'type' in message && message.type === 'atlas-corpus-changed') {
    refreshing = refreshing.then(async () => {
      if (stopped) return;
      await server.stop();
      if (!stopped) server = await dev({ root: process.cwd(), server: { port, host } });
    }).catch(error => { console.error(`Portal refresh failed: ${error.message}`); process.exitCode = 1; });
  }
});
process.once('SIGINT', stop); process.once('SIGTERM', stop);
