import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tools/goshctl/src/**/*.test.ts'],
    environment: 'node',
  },
});
