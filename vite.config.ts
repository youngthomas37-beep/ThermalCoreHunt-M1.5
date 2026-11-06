import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  server: {
    host: '0.0.0.0',
    port: 5199,
    strictPort: true,
    watch: { ignored: ['**/.*', '**/*.tmpdir/**'] },
  },
  build: { target: 'es2022' },
});
