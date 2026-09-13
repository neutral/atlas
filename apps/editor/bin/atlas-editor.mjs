#!/usr/bin/env node
import path from 'node:path';
import { startEditor } from '../src/server.mjs';

const names = { '--atlas': 'atlasPath', '--state-directory': 'stateDirectory', '--evaluator': 'evaluatorModule', '--port': 'port' };
const arguments_ = process.argv.slice(2);
if (arguments_.includes('--help')) {
  console.log('Usage: atlas-editor REPOSITORY --state-directory DIRECTORY [--atlas PATH] [--evaluator MODULE] [--port NUMBER]\nThe state directory retains drafts, recovery files, and reports outside the Atlas, repository tmp, and .git. Evaluator modules are trusted code explicitly selected at launch.');
} else {
  try {
    const repository = arguments_.shift();
    if (!repository || repository.startsWith('-')) throw new Error('An explicit repository is required.');
    const options = { repositoryRoot: path.resolve(repository) };
    while (arguments_.length) {
      const flag = arguments_.shift(), key = names[flag], value = arguments_.shift();
      if (!key || value === undefined || value.startsWith('--') || Object.hasOwn(options, key)) throw new Error(`Unsupported, repeated, or incomplete option: ${flag}`);
      options[key] = key === 'port' ? Number(value) : key === 'atlasPath' ? value : path.resolve(value);
    }
    const editor = await startEditor(options);
    console.log(`Atlas Editor\nRepository: ${editor.info.repositoryRoot}\nOpen: ${editor.url}`);
    const close = async () => { await editor.close(); process.exit(0); };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  } catch (error) {
    console.error(JSON.stringify({ error: { code: error.code ?? 'atlas.editor.launch-failed', message: error.message } }));
    process.exitCode = 2;
  }
}
