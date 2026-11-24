import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const RELAYS: Record<string, string[]> = { phone: ['wss://cloud.openhut.dev'], 'phone-debug': ['wss://cloud.openhut.dev', process.env.OPENHUT_CLOUD_URL?.replace(/^http/, 'ws') ?? 'ws://127.0.0.1:8790'], web: [process.env.VITE_OPENHUT_RELAY_URL ?? 'wss://cloud.openhut.dev', new URL(process.env.VITE_OPENHUT_API_URL ?? 'https://cloud.openhut.dev/api').origin] }

function policy(relays: string[]): Plugin {
  const csp = [
    "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:",
    `connect-src 'self' capacitor://localhost ${relays.join(' ')}`, "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-src 'none'",
  ].join('; ')
  return { name: 'phone-csp', apply: 'build', transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' }] }
}

export default defineConfig(({ mode }) => {
  const relays = RELAYS[mode]
  return {
    plugins: [react(), tailwindcss(), ...relays ? [policy(relays)] : []],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, './src'), 'sodium-native': 'sodium-javascript' } },
    build: { outDir: '../../dist/renderer', emptyOutDir: true },
    server: { proxy: Object.fromEntries(['/api', '^/c/'].map((path) => [path, { target: `http://127.0.0.1:${process.env.PORT ?? 8787}`, ws: true, headers: { authorization: 'Bearer dev' } }])) },
  }
})
