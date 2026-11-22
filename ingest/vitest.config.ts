import { defineConfig } from 'vitest/config';

// The database tests drop and rebuild the same idoc schema in one scratch database, so test files must not run in parallel. Resetting the schema can take more than vitest's 10 s hook default.
export default defineConfig({ test: { fileParallelism: false, hookTimeout: 120_000 } });
