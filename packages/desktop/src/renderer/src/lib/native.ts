import { Capacitor, registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'
import { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } from '@capacitor/barcode-scanner'

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

export function onBack(handler: () => void): () => void {
  if (!isPhone()) return () => {}
  const listener = App.addListener('backButton', handler)
  return () => void listener.then((it) => it.remove())
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function fromHex(text: string): Uint8Array {
  return Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16))
}
