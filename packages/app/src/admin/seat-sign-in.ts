import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SeatSignIn } from '@fastmonkey/common/admin/admin.ts'
import { config } from '../platform/config.ts'
import { log } from '../platform/events.ts'
import { HttpError } from '../platform/http-error.ts'
import { newToken } from '../platform/secrets.ts'

const OPEN_MS = 10 * 60_000
const PROMPT_MS = 30_000
const TOKEN_MS = 120_000
const LINK = /\x1b\]8;[^;]*;(https:\/\/claude\.(?:com|ai)\/[^\x1b\x07\s]*oauth\/authorize\?[^\x1b\x07\s]+)/
const TOKEN = /sk-ant-oat01-[\w-]{20,}/
const FAILED = /OAuth error[^\n]*|wasn't accepted[^\n]*/i
const MAX_OPEN = 3
const open = new Map<string, OpenSignIn>()

export const seatSignIn = {
  async start(): Promise<SeatSignIn> {
    const dir = mkdtempSync(join(tmpdir(), 'fastmonkey-seat-'))
    const proc = spawn('script', ['-qfec', `stty cols 4000 rows 60; exec ${config.claudeBin} setup-token`, '/dev/null'], {
      cwd: dir, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, CLAUDE_CONFIG_DIR: dir, BROWSER: '/bin/true', TERM: 'xterm-256color', DISABLE_AUTOUPDATER: '1' },
    })
    for (const id of [...open.keys()].slice(0, Math.max(0, open.size - MAX_OPEN + 1))) close(id)
    const signIn: OpenSignIn = { id: newToken('seat'), proc, dir, out: '', state: '' }
    proc.stdout.on('data', (chunk: Buffer) => { signIn.out += chunk.toString('utf8') })
    proc.stderr.on('data', (chunk: Buffer) => { signIn.out += chunk.toString('utf8') })
    proc.on('exit', () => close(signIn.id))
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
    signIn.proc.stdin.write(`${code.trim()}\r`)
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
      resolve(value)
    }
    const exited = () => done(find(signIn.out))
    const timer = setTimeout(() => done(undefined), ms)
    signIn.proc.stdout.on('data', check)
    signIn.proc.on('exit', exited)
    check()
  })
}

function close(id: string): void {
  const signIn = open.get(id)
  if (!signIn) return
  open.delete(id)
  signIn.proc.kill()
  rmSync(signIn.dir, { recursive: true, force: true })
}

type OpenSignIn = { id: string; proc: ChildProcessWithoutNullStreams; dir: string; out: string; state: string }
