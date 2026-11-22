import { useQuery, type QueryClient } from '@tanstack/react-query'

export type Ready = { version: string }
export type UpdateState = { current: string; checking: boolean; available: string | null; progress?: number; ready: Ready | null; error: 'signature' | 'failed' | null }
export type UpdateBridge = { state: () => Promise<UpdateState>; check: () => Promise<UpdateState>; install: () => Promise<unknown>; onChange: (listener: (state: UpdateState) => void) => void }

export const UPDATE_KEY = ['app-update']

export const updates: UpdateBridge | undefined = typeof window === 'undefined' ? undefined : Reflect.get(window, 'openhut')?.update

export function followUpdate({ bridge, client }: { bridge: UpdateBridge | undefined; client: Pick<QueryClient, 'setQueryData'> }) {
  if (!bridge) return
  bridge.onChange((state) => client.setQueryData(UPDATE_KEY, state))
  void bridge.state().then((state) => client.setQueryData(UPDATE_KEY, state), () => undefined)
}

export function downloadUrl(platform: string | undefined) {
  return `https://openhut.dev/download/${{ darwin: 'mac', win32: 'windows' }[platform ?? ''] ?? 'linux'}`
}

export function readyNote(state: UpdateState | null | undefined) {
  return state?.ready ? `OpenHut ${state.ready.version} is ready` : undefined
}

export function progressTitle(progress: number | undefined) {
  if ((progress ?? 0) < 35) return 'Packing a few things'
  return (progress ?? 0) < 80 ? 'Fixing up the hut' : 'Nearly there'
}

export function updateNote(state: UpdateState) {
  if (state.ready) return `Version ${state.ready.version} is ready.`
  if (state.error === 'signature') return 'The new version isn\'t signed by OpenHut, so this computer refused it.'
  if (state.error) return 'Couldn\'t update.'
  if (state.available) return `Downloading OpenHut ${state.available}…`
  if (state.checking) return 'Checking…'
  return 'Up to date.'
}

export function useAppUpdate() {
  return useQuery<UpdateState | null>({ queryKey: UPDATE_KEY, queryFn: () => null, initialData: null, staleTime: Infinity })
}
