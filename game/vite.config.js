import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { target: 'esnext', rollupOptions: { input: { main: 'index.html', webgpu: 'webgpu.html' } } },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } }
});
