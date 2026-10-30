import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// npm --prefix client runs Vite with client/ as its working directory. Keep
// development and build environment variables in the documented root .env.
export default defineConfig({
  envDir: '..',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-') || id.includes('node_modules/victory-vendor')) return 'charts';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react-vendor';
        },
      },
    },
  },
});
