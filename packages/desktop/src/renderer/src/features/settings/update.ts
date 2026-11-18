import { useQuery, type QueryClient } from '@tanstack/react-query'

export type Ready = { version: string }
export type UpdateState = { current: string; ready: Ready | null }
export type UpdateBridge = { state: () => Promise<UpdateState>; install: () => Promise<unknown>; onReady: (listener: (ready: Ready) => void) => void }

export const UPDATE_KEY = ['app-update']

export const updates: UpdateBridge | undefined = typeof window === 'undefined' ? undefined : Reflect.get(window, 'openhut')?.update

export function followUpdate({ bridge, client }: { bridge: UpdateBridge | undefined; client: Pick<QueryClient, 'setQueryData'> }) {
  if (!bridge) return
  bridge.onReady((ready) => client.setQueryData<UpdateState | null>(UPDATE_KEY, (state) => state && { ...state, ready }))
  void bridge.state().then((state) => client.setQueryData(UPDATE_KEY, state), () => undefined)
}

export function readyNote(state: UpdateState | null | undefined) {
  return state?.ready ? `OpenHut ${state.ready.version} is ready` : undefined
}

export function useAppUpdate() {
  return useQuery<UpdateState | null>({ queryKey: UPDATE_KEY, queryFn: () => null, initialData: null, staleTime: Infinity })
}
