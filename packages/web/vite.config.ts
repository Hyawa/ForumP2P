import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build loads from file:// (Electron) and from
  // Capacitor's bundled WebView.
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
  },
});
