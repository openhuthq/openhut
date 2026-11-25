import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.ts'
import { HttpError } from './http-error.ts'
import { settings } from './settings.ts'

const UPSTREAM = `reverse_proxy 127.0.0.1:${config.port}`

export const publicAddress = (): string => settings.address() || `http://127.0.0.1:${config.port}`

export function checkAddress(url: string): string {
  const parsed = URL.canParse(url) ? new URL(url) : undefined
  if (parsed?.protocol !== 'https:' || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(parsed.hostname) || /^[\d.]+$/.test(parsed.hostname)) {
    throw new HttpError(400, 'Enter the HTTPS address people will open, like https://agents.example.com. Its DNS must point at this server.', { param: 'address' })
  }
  return parsed.origin
}

export async function saveAddress(origin: string): Promise<void> {
  await settings.setAddress(origin)
  writeCaddyfile()
}

export function writeCaddyfile(): void {
  writeFileSync(join(config.dataDir, 'Caddyfile'), caddyfile(settings.address()))
}

export function caddyfile(address: string | undefined): string {
  if (!address) return `{\n\tauto_https off\n}\n\n:80 {\n\t${UPSTREAM}\n}\n`
  return `${new URL(address).host} {\n\t${UPSTREAM}\n}\n`
}
