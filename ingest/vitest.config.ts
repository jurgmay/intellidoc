import { defineConfig } from 'vitest/config';

// The database tests drop and rebuild the same idoc schema in one scratch database, so test files must not run in parallel.
export default defineConfig({ test: { fileParallelism: false } });
