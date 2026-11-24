import { defineConfig } from 'vite';
import { evalServer } from './evalServer';

// dev.html and eval.html are dev-only pages; the build ships index.html only.
export default defineConfig({
  plugins: [evalServer()],
  build: { rollupOptions: { input: 'index.html' } },
});
