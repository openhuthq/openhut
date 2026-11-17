import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Peer } from '@/features/settings/peers'

export type Tailnet = { state: 'running'; tailnet: string; self: { name: string; os: string; ip: string }; peers: Peer[] } | { state: 'missing' } | { state: 'stopped' }
export type Machine = { chip: string; memory: number; folder: string; size: number }
export type Prefs = { openAtLogin: boolean; keepAwake: boolean; notifyReplies: boolean; notifyFailures: boolean }
export type FirstRun = { failed: boolean; agentId: string; steps: [string, string, 'done' | 'now' | 'next' | 'failed'][] }
export type AppUpdate = { version: string; state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'; next?: string; error?: string }
export type McpCommand = { computer: string; name: string; command: string }
type Failure = { error: string }
type Bridge = {
  mcp?: string
  mcpCommands?: () => Promise<McpCommand[]>
  updates?: { status: () => Promise<AppUpdate>; check: () => Promise<AppUpdate>; install: () => Promise<void> }
  tailnet: () => Promise<Tailnet | Failure>
  machine: () => Promise<Machine | Failure>
  showFolder: () => Promise<string>
  prefs: () => Promise<Prefs | Failure>
  setPrefs: (patch: Partial<Prefs>) => Promise<Prefs | Failure>
  firstRun: (start: boolean) => Promise<FirstRun | Failure>
  onChanged: (listener: () => void) => void
}
const PREFS_KEY = ['prefs']
const FIRST_RUN_POLL_MS = 500

export const desktop: Bridge | undefined = Reflect.get(window, 'openhut')
export const HERE = navigator.userAgent.includes('Mac') ? 'Mac' : 'computer'

export function useTailnet() {
  return useQuery({ queryKey: ['tailnet'], queryFn: async (): Promise<Tailnet> => tailnetOf(await desktop?.tailnet()), enabled: !!desktop, retry: false })
}

export function useMachine() {
  return useQuery({ queryKey: ['machine'], queryFn: () => answer(desktop?.machine()), enabled: !!desktop, retry: false })
}

export function usePrefs() {
  return useQuery({ queryKey: PREFS_KEY, queryFn: () => answer(desktop?.prefs()), enabled: !!desktop, retry: false })
}

export function useSetPrefs() {
  const client = useQueryClient()
  return useMutation({ mutationFn: (patch: Partial<Prefs>) => answer(desktop?.setPrefs(patch)), onSuccess: (prefs) => client.setQueryData(PREFS_KEY, prefs) })
}

export function useFirstRun(started: boolean) {
  return useQuery({ queryKey: ['first-run', started], queryFn: () => answer(desktop?.firstRun(started)), refetchInterval: (query) => started && !query.state.data?.agentId && !query.state.data?.failed ? FIRST_RUN_POLL_MS : false })
}

function tailnetOf(result: Tailnet | Failure | { tailnet: string; self: { name: string; os: string; ip: string }; peers: Peer[] } | undefined): Tailnet {
  if (!result || 'error' in result) return { state: result && /installed/.test(result.error) ? 'missing' : 'stopped' }
  if ('state' in result) return result
  return { state: 'running', ...result }
}

async function answer<T extends object>(call: Promise<T | Failure> | undefined): Promise<T> {
  const result = await call
  if (!result) throw new Error('Open the OpenHut app on this computer to see this.')
  if ('error' in result) throw new Error(String(result.error))
  return result
}

export function home(path: string) {
  return path.replace(/\/(Users|home)\/[^/\s"]+/g, '~')
}

export function bytes(size: number) {
  if (size >= 1 << 30) return `${(size / (1 << 30)).toFixed(2)} GB`
  if (size >= 1 << 20) return `${Math.round(size / (1 << 20))} MB`
  return `${Math.max(0, Math.round(size / 1024))} KB`
}
