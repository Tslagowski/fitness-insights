import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

// Each PGlite instance embeds a WASM PostgreSQL that needs a few hundred MB,
// so the default worker count gets workers killed on 8 GB machines. Files that
// import @electric-sql/pglite run in their own project with a capped pool;
// everything else keeps the default parallelism.
const pgliteTests = ['tests/access.test.ts', 'tests/*-database.test.ts'];

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/**/*.test.ts'], exclude: pgliteTests, sequence: { groupOrder: 1 } },
      },
      {
        extends: true,
        test: { name: 'database', include: pgliteTests, maxWorkers: 2, sequence: { groupOrder: 2 } },
      },
    ],
  },
});
