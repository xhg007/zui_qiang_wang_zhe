import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // happy-dom 提供 document / location，适配层测试直接可用
    environment: 'happy-dom',
    include: ['lib/**/*.test.ts'],
  },
});
