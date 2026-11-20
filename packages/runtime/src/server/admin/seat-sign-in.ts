import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { SeatSignIn } from '@openhut/common/admin/admin.ts'
import { config } from '../platform/config.ts'
import { log } from '../platform/events.ts'
import { HttpError } from '../platform/http-error.ts'
import { newToken } from '../platform/secrets.ts'

const OPEN_MS = 10 * 60_000
const PROMPT_MS = 30_000
const TOKEN_MS = 120_000
const ENTER_AFTER_MS = 500
const LINK = /\x1b\]8;[^;]*;(https:\/\/claude\.(?:com|ai)\/[^\x1b\x07\s]*oauth\/authorize\?[^\x1b\x07\s]+)/
const TOKEN = /sk-ant-oat01-[\w-]{20,}/
const FAILED = /OAuth error[^\n]*|wasn't accepted[^\n]*/i
const MAX_OPEN = 3
const WIN_PTY = `import os, sys, threading
sys.path.insert(0, os.environ['OPENHUT_SITE'])
from winpty import PtyProcess
p = PtyProcess.spawn([os.environ['OPENHUT_CLAUDE_BIN'], 'setup-token'], dimensions=(60, 4000))
def feed():
    while d := os.read(0, 4096):
        p.write(d.decode('utf-8', 'replace'))
threading.Thread(target=feed, daemon=True).start()
while True:
    try: d = p.read(4096)
    except EOFError: break
    sys.stdout.buffer.write(d.encode('utf-8'))
    sys.stdout.buffer.flush()
`
const MAC_PTY = 'log_user 1; set timeout -1; fconfigure stdin -blocking 0 -translation binary; spawn -noecho sh -c $env(OPENHUT_RUN); fileevent stdin readable { set d [read stdin]; if {[eof stdin]} { exit 0 }; send -- $d }; expect eof'
const open = new Map<string, OpenSignIn>()

export const seatSignIn = {
  async start(): Promise<SeatSignIn> {
    await hostClaude()
    const dir = mkdtempSync(join(tmpdir(), 'openhut-seat-'))
    const run = `stty cols 4000 rows 60; exec '${config.claudeHostBin}' setup-token`
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, CLAUDE_CONFIG_DIR: dir, BROWSER: '/bin/true', TERM: 'xterm-256color', DISABLE_AUTOUPDATER: '1' }
    const proc = terminal({ dir, env, run })
    for (const id of [...open.keys()].slice(0, Math.max(0, open.size - MAX_OPEN + 1))) close(id)
    const signIn: OpenSignIn = { id: newToken('seat'), proc, dir, out: '', state: '' }
    proc.stdout.on('data', (chunk: Buffer) => { signIn.out += chunk.toString('utf8') })
    proc.stderr.on('data', (chunk: Buffer) => { signIn.out += chunk.toString('utf8') })
    proc.on('exit', () => close(signIn.id))
    proc.on('error', (error) => {
      signIn.out += `\n${error.message}`
      close(signIn.id)
    })
    open.set(signIn.id, signIn)
    setTimeout(() => close(signIn.id), OPEN_MS).unref()
    const url = await waitFor({ signIn, ms: PROMPT_MS, find: (out) => signInLink(out) })
    if (!url) {
      log.warn({ event: 'seat.sign_in_failed', step: 'link', output: plain(signIn.out).slice(-500) })
      close(signIn.id)
      throw new HttpError(503, 'Claude Code didn\'t give a sign-in link. Try again in a minute.')
    }
    signIn.state = stateOf(url)
    return { id: signIn.id, object: 'seat_sign_in', status: 'open', url }
  },

  async complete({ id, code }: { id: string; code: string }): Promise<string> {
    const signIn = signInFor({ id, code })
    if (!signIn) throw new HttpError(404, 'That sign-in is over (each one lasts 10 minutes and takes one code). Press Set up again for a new one.')
    const before = signIn.out.length
    signIn.proc.stdin.write(code.trim())
    await new Promise((resolve) => setTimeout(resolve, ENTER_AFTER_MS))
    signIn.proc.stdin.write('\r')
    const token = await waitFor({ signIn, ms: TOKEN_MS, find: (out) => seatToken(out.slice(before)) ?? (FAILED.test(plain(out.slice(before))) ? 'failed' : undefined) })
    const said = plain(signIn.out.slice(before)).replace(TOKEN, '[token]').replace(/\*{6,}/g, '[code]')
    close(signIn.id)
    if (token && token !== 'failed') {
      log.info({ event: 'seat.signed_in' })
      return token
    }
    log.warn({ event: 'seat.sign_in_failed', step: 'code', output: said.slice(-2000) })
    const reason = FAILED.exec(said)?.[0]?.replace(/Press Enter to retry\.?/, '').trim()
    throw new HttpError(400, reason ? `Claude said: ${reason} Press Set up again for a new code.` : 'Claude didn\'t answer within 2 minutes. Press Set up again for a new code.', { param: 'code' })
  },
}

function terminal({ dir, env, run }: { dir: string; env: Record<string, string>; run: string }): ChildProcessWithoutNullStreams {
  if (process.platform === 'darwin') return spawn('/usr/bin/expect', ['-c', MAC_PTY], { cwd: dir, env: { ...env, OPENHUT_RUN: run } })
  if (process.platform !== 'win32') return spawn('script', ['-qfec', run, '/dev/null'], { cwd: dir, env })
  if (!config.hermesRuntime) throw new HttpError(503, 'This build doesn\'t say where its agent runtime is, so it can\'t run the Claude sign-in.')
  const system = { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows', USERPROFILE: dir, APPDATA: dir, LOCALAPPDATA: dir, TEMP: dir, TMP: dir }
  return spawn(join(config.hermesRuntime, 'python', 'python.exe'), ['-s', '-c', WIN_PTY], { cwd: dir, env: { ...env, ...system, OPENHUT_SITE: join(config.hermesRuntime, 'site'), OPENHUT_CLAUDE_BIN: config.claudeHostBin } })
}

async function hostClaude(): Promise<void> {
  const bin = config.claudeHostBin
  if (process.platform !== 'darwin' || (existsSync(bin) && (!config.claudeVersion || versionOf(bin) === config.claudeVersion))) return
  if (!config.claudeVersion) throw new HttpError(503, 'Claude Code isn\'t on this Mac yet, and this build doesn\'t say which version to get.')
  const base = `https://downloads.claude.ai/claude-code-releases/${config.claudeVersion}`
  const platform = `darwin-${process.arch}`
  const failed = () => new HttpError(503, 'Couldn\'t download Claude Code for the sign-in. Check the internet connection and try again.')
  const manifest = await fetch(`${base}/manifest.json`, { signal: AbortSignal.timeout(30_000) }).then((r) => r.json() as Promise<{ platforms: Record<string, { checksum: string }> }>).catch(() => { throw failed() })
  const body = Buffer.from(await fetch(`${base}/${platform}/claude`, { signal: AbortSignal.timeout(300_000) }).then((r) => r.arrayBuffer()).catch(() => { throw failed() }))
  if (createHash('sha256').update(body).digest('hex') !== manifest.platforms[platform]?.checksum) throw failed()
  mkdirSync(dirname(bin), { recursive: true })
  writeFileSync(`${bin}.new`, body)
  chmodSync(`${bin}.new`, 0o755)
  renameSync(`${bin}.new`, bin)
  writeFileSync(`${bin}.version`, config.claudeVersion)
  log.info({ event: 'seat.claude_downloaded', version: config.claudeVersion })
}

function versionOf(bin: string): string {
  try { return readFileSync(`${bin}.version`, 'utf8').trim() } catch { return '' }
}

function signInFor({ id, code }: { id: string; code: string }): OpenSignIn | undefined {
  const state = code.trim().split('#')[1]
  return [...open.values()].find((signIn) => state && signIn.state === state) ?? open.get(id)
}

export const stateOf = (url: string): string => new URL(url).searchParams.get('state') ?? ''

export const signInLink = (out: string): string | undefined => LINK.exec(out)?.[1]

export const seatToken = (out: string): string | undefined => TOKEN.exec(plain(out))?.[0]

const plain = (out: string): string => out.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, '').replace(/\r/g, '')

function waitFor({ signIn, ms, find }: { signIn: OpenSignIn; ms: number; find: (out: string) => string | undefined }): Promise<string | undefined> {
  return new Promise((resolve) => {
    const check = () => {
      const found = find(signIn.out)
      if (found) done(found)
    }
    const done = (value: string | undefined) => {
      clearTimeout(timer)
      signIn.proc.stdout.off('data', check)
      signIn.proc.off('exit', exited)
      signIn.proc.off('error', exited)
      resolve(value)
    }
    const exited = () => done(find(signIn.out))
    const timer = setTimeout(() => done(undefined), ms)
    signIn.proc.stdout.on('data', check)
    signIn.proc.on('exit', exited)
    signIn.proc.on('error', exited)
    check()
  })
}

function close(id: string): void {
  const signIn = open.get(id)
  if (!signIn) return
  open.delete(id)
  if (process.platform === 'win32' && signIn.proc.pid) spawn('taskkill', ['/pid', String(signIn.proc.pid), '/t', '/f']).on('error', () => {})
  else signIn.proc.kill()
  rm(signIn.dir, { recursive: true, force: true, maxRetries: 20 }).catch((error: Error) => log.warn({ event: 'seat.cleanup_failed', error: error.message }))
}

type OpenSignIn = { id: string; proc: ChildProcessWithoutNullStreams; dir: string; out: string; state: string }
