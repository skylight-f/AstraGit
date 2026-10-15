import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/** 开发态放宽 script-src，允许 Vite React Refresh 内联脚本；生产构建保持严格 CSP。 */
function devCspPlugin(): Plugin {
  return {
    name: 'astragit-dev-csp',
    transformIndexHtml(html, ctx) {
      if (!ctx.server) return html;
      return html.replace(
        /content="default-src 'self'; script-src 'self';/,
        `content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval';`,
      );
    },
  };
}

export default defineConfig(({ command }) => ({
  root: import.meta.dirname,
  base: './',
  plugins: [react(), devCspPlugin()],
  // Dev reads shared source directly; production uses the built local package.
  ...(command === 'serve' ? {
    resolve: { alias: [{ find: /^@astragit\/shared$/u, replacement: resolve(import.meta.dirname, '../../packages/shared/src/index.ts') }] },
    optimizeDeps: { exclude: ['@astragit/shared'] },
  } : {}),
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'index.html'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5179,
    strictPort: true,
  },
}));
