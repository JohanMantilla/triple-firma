import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The backend is the Next.js app (npm run dev in the repo root, port 3000).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': process.env.VITE_API_TARGET || 'http://localhost:3000' } }
});
