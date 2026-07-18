import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@gosh/protocol': path.resolve(__dirname, '../../app/src/agent/protocol'),
    },
  },
});
