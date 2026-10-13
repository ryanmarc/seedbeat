import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            'packages/*/src/**/*.test.ts',
            'apps/game/src/**/*.test.ts',
            'tools/size/**/*.test.ts',
            'tools/timing/**/*.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'golden',
          include: ['tools/golden/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'audio',
          include: ['packages/worklet/audio/**/*.test.ts'],
          testTimeout: 600_000,
        },
      },
    ],
  },
});
