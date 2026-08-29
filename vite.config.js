import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // host: true binds every interface, so the LAN URL works from a phone
  // or another machine, not just localhost.
  server: { open: true, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
