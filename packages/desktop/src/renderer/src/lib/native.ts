import { Capacitor, registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'
import { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } from '@capacitor/barcode-scanner'
import { Preferences } from '@capacitor/preferences'

type DeviceKeyPlugin = {
  publicKey(): Promise<{ publicKey: string }>
  agree(options: { publicKey: string }): Promise<{ secret: string }>
  wipe(): Promise<void>
}

export type DeviceKey = { publicKey: Uint8Array; agree(remote: Uint8Array): Promise<Uint8Array> }

const plugin = registerPlugin<DeviceKeyPlugin>('DeviceKey')

export function isPhone(): boolean {
  return Capacitor.isNativePlatform()
}

export async function scan(): Promise<string | undefined> {
  if (!isPhone()) return undefined
  const { ScanResult } = await CapacitorBarcodeScanner.scanBarcode({ hint: CapacitorBarcodeScannerTypeHint.QR_CODE })
  return ScanResult || undefined
}

export async function deviceKey(): Promise<DeviceKey | undefined> {
  if (!isPhone()) return undefined
  const { publicKey } = await plugin.publicKey()
  return {
    publicKey: fromHex(publicKey),
    agree: async (remote) => fromHex((await plugin.agree({ publicKey: toHex(remote) })).secret),
  }
}

export async function wipe(): Promise<void> {
  if (!isPhone()) return
  await plugin.wipe()
  await Preferences.clear()
}

export const saved = {
  get: async (key: string): Promise<string | undefined> => (await Preferences.get({ key })).value ?? undefined,
  set: (key: string, value: string): Promise<void> => Preferences.set({ key, value }),
}

export function phoneName(): string {
  return Capacitor.getPlatform() === 'ios' ? 'iPhone' : 'Android phone'
}

export function onBack(handler: () => void): () => void {
  if (!isPhone()) return () => {}
  const listener = App.addListener('backButton', handler)
  return () => void listener.then((it) => it.remove())
}

export function leave(): void {
  void App.minimizeApp()
}

export function onLink(handler: (url: string) => void): () => void {
  if (!isPhone()) return () => {}
  void App.getLaunchUrl().then((launch) => { if (launch?.url) handler(launch.url) })
  const listener = App.addListener('appUrlOpen', ({ url }) => handler(url))
  return () => void listener.then((it) => it.remove())
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function fromHex(text: string): Uint8Array {
  return Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16))
}
