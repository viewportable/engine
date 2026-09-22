import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    cssMinify: false,
    rollupOptions: {
      input: {
        baseline: path.join(root, 'baseline.html'),
        candidate: path.join(root, 'candidate.html'),
      },
    },
  },
});
