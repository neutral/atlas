import path from 'node:path';
import { defineConfig } from 'astro/config';

const configuredOutput = process.env.ATLAS_PORTAL_OUT_DIR;

export default defineConfig({
  output: 'static',
  outDir: configuredOutput ? path.resolve(configuredOutput) : undefined,
  server: {
    host: '127.0.0.1',
  },
  build: {
    format: 'directory',
  },
  vite: {
    server: {
      fs: {
        strict: true,
      },
    },
  },
});
