import { useQuery, type QueryClient } from '@tanstack/react-query'
import { desktop } from '../../lib/desktop.ts'

// M5: what the shell's pack updater says about a release it checked (SEC6): the release key and its Rekor entry.
export type Signed = { key: string; logIndex: number; loggedAt: number }
export type Ready = { version: string; pack?: boolean; signed?: Signed }
export type UpdateState = { current: string; asksPassword?: boolean; checking: boolean; available: string | null; progress?: number; ready: Ready | null; installing?: boolean; error: 'signature' | 'failed' | 'not-installed' | null; waiting?: { version: string; retryAt: number; signed?: Signed } | null; refused?: string | null; halted?: { at: number } | null }
export type UpdateBridge = { state: () => Promise<UpdateState>; check: () => Promise<UpdateState>; install: () => Promise<unknown>; onChange: (listener: (state: UpdateState) => void) => void }

export const UPDATE_KEY = ['app-update']

export const updates: UpdateBridge | undefined = desktop?.update

export function followUpdate({ bridge, client }: { bridge: UpdateBridge | undefined; client: Pick<QueryClient, 'setQueryData'> }) {
  if (!bridge) return
  bridge.onChange((state) => client.setQueryData(UPDATE_KEY, state))
  void bridge.state().then((state) => client.setQueryData(UPDATE_KEY, state), () => undefined)
}

export function downloadUrl(platform: string | undefined) {
  return `https://openhut.dev/download/${{ darwin: 'mac', win32: 'windows' }[platform ?? ''] ?? 'linux'}`
}

export function readyNote(state: UpdateState | null | undefined) {
  if (!state?.ready) return undefined
  if (state.installing) return 'Installing… your computer is asking for your password'
  if (state.error === 'not-installed') return `OpenHut ${state.ready.version} wasn't installed. Try again when you're ready to enter your password`
  return state.asksPassword ? `OpenHut ${state.ready.version} is ready. Your computer will ask for your password to install it` : `OpenHut ${state.ready.version} is ready`
}

export function updateCard({ app, servers }: { app: UpdateState | null | undefined; servers: number }) {
  if (app?.ready && app.error === 'not-installed') return { title: 'Update not installed', note: 'Nothing changed. Try again when you’re ready to enter your password.', label: 'Try again' }
  if (!app?.ready) return { title: 'Update available', note: 'Your agents keep working', label: 'Update' }
  const note = `Version ${app.ready.version} is ready${app.asksPassword ? '. Your computer will ask for your password to install it.' : ''}`
  return { title: 'Update ready', note, label: servers ? 'Update and restart' : 'Restart to update' }
}

export function progressTitle(progress: number | undefined) {
  return (progress ?? 0) < 80 ? 'Downloading the update' : 'Almost ready'
}

export function updateNote(state: UpdateState) {
  if (state.installing) return 'Installing… your computer is asking for your password.'
  if (state.ready && state.error === 'not-installed') return 'Update not installed.'
  if (state.halted) return 'OpenHut paused this update. This version keeps working.'
  if (state.ready?.signed) return `Version ${state.ready.version} is ready. Signed and publicly logged · verified.`
  if (state.ready) return `Version ${state.ready.version} is ready.`
  if (state.waiting) return `Version ${state.waiting.version} installs in ${minutes(state.waiting.retryAt - Date.now())}.`
  if (state.refused) return /Rekor|log/.test(state.refused) ? 'This update isn\'t in the public log, so OpenHut won\'t install it.' : 'This update didn\'t come from OpenHut, so it wasn\'t installed.'
  if (state.error === 'signature') return 'This update didn\'t come from OpenHut, so it wasn\'t installed. Download OpenHut again.'
  if (state.error) return 'Couldn\'t update. Try again, or download the new version.'
  if (state.available) return `Downloading OpenHut ${state.available}…`
  if (state.checking) return 'Checking…'
  return 'Up to date.'
}

const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`

// The details sheet: what was checked, for the release that's ready or waiting.
export function updateDetails(state: UpdateState) {
  const signed = state.ready?.signed ?? state.waiting?.signed
  if (!signed) return undefined
  return {
    key: signed.key,
    entry: `https://search.sigstore.dev/?logIndex=${signed.logIndex}`,
    logIndex: signed.logIndex,
    checks: ['Signed with OpenHut\'s release key', 'In the public log (Rekor), with its signed timestamp', 'The log entry is for exactly this release', ...(state.waiting ? ['Waiting period not over yet'] : [])],
  }
}

export async function readUpdate(bridge: UpdateBridge | undefined): Promise<UpdateState | null> {
  return bridge ? bridge.state() : null
}

export function useAppUpdate() {
  return useQuery<UpdateState | null>({ queryKey: UPDATE_KEY, queryFn: () => readUpdate(updates), staleTime: Infinity, gcTime: Infinity })
}
