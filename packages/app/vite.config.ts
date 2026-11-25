import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const DEV_CONFIG = JSON.stringify({
  cloud: process.env.OPENHUT_API_URL ?? 'https://cloud.openhut.dev/api',
  ...process.env.OPENHUT_WEB === '1' ? {} : { local: true },
  ...process.env.OPENHUT_DEV_LABEL ? { dev: process.env.OPENHUT_DEV_LABEL } : {},
})

function devConfig(): Plugin {
  return { name: 'config-json', apply: 'serve', configureServer: (server) => { server.middlewares.use('/config.json', (_req, res) => { res.setHeader('content-type', 'application/json'); res.end(DEV_CONFIG) }) } }
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss(), devConfig()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src'), 'sodium-native': 'sodium-javascript' } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: { proxy: Object.fromEntries(['/api', '^/c/'].map((path) => [path, { target: `http://127.0.0.1:${process.env.PORT ?? 8787}`, ws: true, headers: { authorization: 'Bearer dev' } }])) },
})
