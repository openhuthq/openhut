import type { Enrollment, TailnetPeer } from '@/lib/openhut'
import type { Channel } from '@/lib/live-socket'
import type { FirstRun, Machine, Prefs, Tailnet } from '@/features/settings/desktop'
import type { UpdateBridge } from '@/features/settings/update'

export type Failure = { error: string }
export type PasskeyReply = { prf?: string; error?: string; passkeys?: boolean; message?: string }

export type Desktop = {
  platform?: string
  dev?: string
  version?: string
  tailnet: () => Promise<Tailnet | Failure>
  machine: () => Promise<Machine | Failure>
  showFolder: () => Promise<string>
  prefs: () => Promise<Prefs | Failure>
  setPrefs: (patch: Partial<Prefs>) => Promise<Prefs | Failure>
  firstRun: () => Promise<FirstRun | Failure>
  onChanged: (listener: () => void) => void
  focus?: () => Promise<unknown>
  update?: UpdateBridge
  browserLive?: (path: string, onLine: (line: string) => void, onClose: (code: number, reason: string) => void) => Channel
  cloud?: { notify: (input?: { title: string; body: string; path: string }) => Promise<{ shown?: boolean }> }
  passkey?: { status: () => Promise<PasskeyReply>; create: (input: { email: string }) => Promise<PasskeyReply>; open: (input?: { quiet: boolean }) => Promise<PasskeyReply>; cancel: () => Promise<void> }
  touchId?: { prompt: (reason: string) => Promise<{ ok: boolean }> }
  kit?: { save: (input: { name: string; body: string }) => Promise<{ canceled?: boolean; text?: string }> }
  invite?: { forget: () => Promise<unknown>; keep?: (path: string) => Promise<unknown>; clearClipboard: () => Promise<unknown> }
  computers?: {
    add: (input: { peer: TailnetPeer; join: string }) => Promise<unknown>
    enrollments: () => Promise<Enrollment[]>
    dismiss: (input: { dns: string }) => Promise<unknown>
    onEnrollments: (listener: (list: Enrollment[]) => void) => void
  }
}

export const desktop: Desktop | undefined = Reflect.get(globalThis, 'openhut')
