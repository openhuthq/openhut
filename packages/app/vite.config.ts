import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  envPrefix: ['VITE_', 'OPENHUT_DEV_LABEL'],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: { proxy: { '/api': { target: `http://127.0.0.1:${process.env.PORT ?? 8787}`, ws: true, headers: { authorization: 'Bearer dev' } } } },
})
