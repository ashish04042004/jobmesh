import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Same-origin /api in dev (Vite proxy) and in Docker (nginx proxy), so no CORS setup is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': process.env.VITE_API_PROXY || 'http://localhost:4000' },
  },
});
