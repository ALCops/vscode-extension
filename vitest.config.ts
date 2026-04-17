import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        root: '.',
        include: ['tests/**/*.test.ts'],
        globals: true,
        testTimeout: 10000,
    },
});
