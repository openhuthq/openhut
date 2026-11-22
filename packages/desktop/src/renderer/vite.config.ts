import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const VAULT_SHA256 = createHash('sha256').update(readFileSync(path.resolve(import.meta.dirname, '../../../common/src/vault/vault.ts'))).digest('hex')
const RELAYS = { phone: ['wss://cloud.openhut.dev'], 'phone-debug': ['wss://cloud.openhut.dev', process.env.OPENHUT_RELAY_URL ?? 'ws://127.0.0.1:8790'] }

function policy(relays: string[]): Plugin {
  const csp = [
    "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:",
    `connect-src 'self' capacitor://localhost ${relays.join(' ')}`, "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-src 'none'",
  ].join('; ')
  return { name: 'phone-csp', transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' }] }
}

export default defineConfig(({ mode }) => {
  const relays = mode === 'phone' || mode === 'phone-debug' ? RELAYS[mode] : undefined
  return {
    plugins: [react(), tailwindcss(), ...relays ? [policy(relays)] : []],
    define: { 'import.meta.env.VITE_VAULT_SHA256': JSON.stringify(VAULT_SHA256) },
    resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
    build: { outDir: '../../dist/renderer', emptyOutDir: true },
    server: { proxy: { '/api': { target: `http://127.0.0.1:${process.env.PORT ?? 8787}`, ws: true, headers: { authorization: 'Bearer dev' } } } },
  }
})
