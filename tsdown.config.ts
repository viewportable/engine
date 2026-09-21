import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/cli.ts', 'src/mcp.ts'],
  format: ['esm'],
  platform: 'node',
  clean: true,
  sourcemap: true,
});
