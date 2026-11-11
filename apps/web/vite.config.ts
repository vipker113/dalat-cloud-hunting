import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@dalat/protocol'],
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          'three-core': ['three', 'three-mesh-bvh', 'meshoptimizer'],
          'r3f-drei': ['@react-three/fiber', '@react-three/drei'],
          'multiplayer': ['@colyseus/sdk', 'zustand'],
        },
      },
    },
  },
});
