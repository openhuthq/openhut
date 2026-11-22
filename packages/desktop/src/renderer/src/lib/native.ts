import { Capacitor, registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Keyboard } from '@capacitor/keyboard'
import { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } from '@capacitor/barcode-scanner'
import { Preferences } from '@capacitor/preferences'
import { LiveUpdate } from '@capawesome/capacitor-live-update'
import { latestBundle } from '@/lib/updates'

type DeviceKeyPlugin = {
  publicKey(): Promise<{ publicKey: string }>
  agree(options: { publicKey: string }): Promise<{ secret: string }>
  wipe(): Promise<void>
  confirm(options: { reason: string }): Promise<void>
}

export type DeviceKey = { publicKey: Uint8Array; agree(remote: Uint8Array): Promise<Uint8Array> }

const plugin = registerPlugin<DeviceKeyPlugin>('DeviceKey')

if (Capacitor.getPlatform() === 'ios') void Keyboard.setAccessoryBarVisible({ isVisible: false })
if (Capacitor.isNativePlatform()) document.addEventListener('dragstart', (event) => event.preventDefault())
if (Capacitor.getPlatform() === 'ios') {
  void Keyboard.addListener('keyboardWillShow', ({ keyboardHeight }) => keyboard(keyboardHeight))
  void Keyboard.addListener('keyboardWillHide', () => keyboard(0))
}

function keyboard(height: number) {
  const root = document.documentElement
  root.style.setProperty('--kb', `${height}px`)
  root.toggleAttribute('data-keyboard', height > 0)
  const field = document.activeElement
  if (height && field instanceof HTMLElement && field.matches('input, textarea')) setTimeout(() => field.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 320)
}

export function isPhone(): boolean {
  return Capacitor.isNativePlatform()
}

export async function scan(): Promise<string | undefined> {
  if (!isPhone()) return undefined
  const { ScanResult } = await CapacitorBarcodeScanner.scanBarcode({ hint: CapacitorBarcodeScannerTypeHint.QR_CODE })
  return ScanResult || undefined
}

if (isPhone()) document.addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="http"]') : null
  if (!link || link.origin === location.origin) return
  event.preventDefault()
  openPage(link.href)
})

export function openPage(url: string): void {
  if (isPhone()) void Browser.open({ url, presentationStyle: 'popover' })
  else window.open(url, '_blank')
}

export async function devicePublicKey(): Promise<string | undefined> {
  if (!isPhone()) return undefined
  return (await plugin.publicKey()).publicKey
}

export class UnlockCanceled extends Error {}

export async function deviceKey(): Promise<DeviceKey | undefined> {
  if (!isPhone()) return undefined
  const { publicKey } = await plugin.publicKey()
  return {
    publicKey: fromHex(publicKey),
    agree: async (remote) => fromHex((await plugin.agree({ publicKey: toHex(remote) }).catch((err: unknown) => {
      throw Reflect.get(Object(err), 'code') === 'canceled' ? new UnlockCanceled(String(Reflect.get(Object(err), 'message'))) : err
    })).secret),
  }
}

export async function confirmed(reason: string): Promise<boolean> {
  if (!isPhone()) return true
  return plugin.confirm({ reason }).then(() => true, () => false)
}

export async function wipe(): Promise<void> {
  if (!isPhone()) return
  await plugin.wipe()
  const { keys } = await Preferences.keys()
  await Promise.all(keys.filter((key) => !key.startsWith('update.')).map((key) => Preferences.remove({ key })))
}

export const saved = {
  get: async (key: string): Promise<string | undefined> => (await Preferences.get({ key })).value ?? undefined,
  set: (key: string, value: string): Promise<void> => Preferences.set({ key, value }),
}

export function phoneName(): string {
  return Capacitor.getPlatform() === 'ios' ? 'iPhone' : 'Android phone'
}

export function onBack(handler: () => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {}
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

const UPDATES_URL: string = import.meta.env.VITE_PHONE_UPDATES_URL ?? 'https://cloud.openhut.dev/v1/updates'
const UPDATE_KEY: string | undefined = import.meta.env.VITE_PHONE_UPDATE_KEY
let updating: Promise<void> | undefined

export function update(): Promise<void> {
  updating ??= isPhone() && UPDATE_KEY ? nextBundle(UPDATE_KEY).catch((error: unknown) => console.warn(`Live update: ${error}`)) : Promise.resolve()
  return updating
}

async function nextBundle(key: string): Promise<void> {
  const { currentBundleId, previousBundleId, rollback } = await LiveUpdate.ready()
  const good = (await Preferences.get({ key: 'update.good' })).value
  if (rollback && previousBundleId) {
    console.warn(`Live update: ${previousBundleId} didn't start in time, back to ${good ?? 'the built-in bundle'}`)
    if (!good || good === previousBundleId) return
    await LiveUpdate.setNextBundle({ bundleId: good })
    return LiveUpdate.reload()
  }
  if (currentBundleId) await Preferences.set({ key: 'update.good', value: currentBundleId })
  const { versionName } = await LiveUpdate.getVersionName()
  const highest = Number((await Preferences.get({ key: 'update.sequence' })).value ?? -1)
  const verdict = await latestBundle({ updatesUrl: UPDATES_URL, key, appVersion: versionName, highest })
  if ('refused' in verdict) return console.info(`Live update: refused, ${verdict.refused}`)
  const { bundleId, sequence, url, sha256, bundleSignature } = verdict.manifest
  if ((await LiveUpdate.getBlockedBundles()).bundleIds.includes(bundleId)) return console.info(`Live update: refused, ${bundleId} rolled back before`)
  await LiveUpdate.downloadBundle({ url, bundleId, checksum: sha256, signature: bundleSignature })
  await LiveUpdate.setNextBundle({ bundleId })
  await Preferences.set({ key: 'update.sequence', value: String(sequence) })
  console.info(`Live update: ${bundleId} (sequence ${sequence}) starts on the next launch`)
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function fromHex(text: string): Uint8Array {
  return Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16))
}
