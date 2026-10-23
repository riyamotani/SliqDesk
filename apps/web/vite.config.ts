import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.API_URL ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the browser talks only to Vite, which forwards API and
    // WebSocket traffic. Same origin, so the session cookie just works and no
    // CORS is needed (nginx plays this role in Docker).
    proxy: {
      '/api': apiTarget,
      '/socket.io': { target: apiTarget, ws: true },
    },
  },
});
