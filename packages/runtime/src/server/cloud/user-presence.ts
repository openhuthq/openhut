import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'

type Port = { postMessage: (message: unknown) => void; on: (event: 'message', listener: (event: { data: unknown }) => void) => void }
type Answer = { type: 'presence'; id: string; ok: boolean }
type Ran = { code: number | string | null; out: string }

const parent: Port | undefined = Reflect.get(process, 'parentPort')
const waiting = new Map<string, (ok: boolean) => void>()
let listening = false

const HELLO = `$null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
$asked = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($env:OPENHUT_REASON)
$task = $asTask.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerificationResult]).Invoke($null, @($asked))
$task.Wait()
Write-Output $task.Result`
const NO_HELLO = ['DeviceNotPresent', 'NotConfiguredForUser']

function answered(message: unknown): void {
  const answer = message as Partial<Answer> | null
  if (answer?.type !== 'presence' || typeof answer.id !== 'string') return
  waiting.get(answer.id)?.(answer.ok === true)
  waiting.delete(answer.id)
}

function run({ file, args, env }: { file: string; args: string[]; env?: Record<string, string> }): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(file, args, { env: { ...process.env, ...env }, windowsHide: true }, (error, stdout) => {
      const code = error ? (error as NodeJS.ErrnoException).code ?? null : 0
      resolve({ code: typeof code === 'number' || typeof code === 'string' ? code : 1, out: String(stdout).trim() })
    })
  })
}

export const userPresence = {
  platform: process.platform,
  run,

  shell: (): boolean => Boolean(parent || process.send),

  async ask(reason: string): Promise<boolean> {
    if (!userPresence.shell()) return true
    if (userPresence.platform === 'win32') return userPresence.windowsHello(reason)
    if (userPresence.platform === 'linux') return userPresence.polkit()
    return userPresence.touchId(reason)
  },

  async windowsHello(reason: string): Promise<boolean> {
    const { code, out } = await userPresence.run({ file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', HELLO], env: { OPENHUT_REASON: `OpenHut wants to ${reason}.` } })
    return code === 0 && (out === 'Verified' || NO_HELLO.includes(out))
  },

  async polkit(): Promise<boolean> {
    const { code } = await userPresence.run({ file: 'pkcheck', args: ['--action-id', 'org.freedesktop.policykit.exec', '--process', String(process.pid), '--allow-user-interaction'] })
    return code === 0 || code === 'ENOENT'
  },

  async touchId(reason: string): Promise<boolean> {
    if (!listening) {
      listening = true
      if (parent) parent.on('message', (event) => answered(event.data))
      else process.on('message', answered)
    }
    const id = randomUUID()
    const ok = new Promise<boolean>((resolve) => waiting.set(id, resolve))
    const message = { type: 'presence', id, reason }
    if (parent) parent.postMessage(message)
    else process.send?.(message)
    return ok
  },
}
