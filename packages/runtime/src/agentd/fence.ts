import { once } from 'node:events'
import { createServer, type AddressInfo } from 'node:net'
import { networkInterfaces } from 'node:os'
import { text } from 'node:stream/consumers'
import { errorText } from './util.ts'
import type { Sandboxes, SandboxSpec } from './sandbox/sandbox.ts'
import { config } from './config.ts'

type FenceCheck = { name: string; target: string; expect: 'refused' | 'allowed'; got: string; pass: boolean }
export type FenceReport = { ok: boolean; sandbox: string; skipped?: string; checks: FenceCheck[] }
type Probe = Omit<FenceCheck, 'got' | 'pass'> & { waits?: true }

const FENCE_NET = 0
const PROBE_SECONDS = 6
const TIMEOUT_MS = 30_000
const STATUS = / =>(\d{3})\s*$/
const CURL_ERROR = /curl: \(\d+\)[^=]*/
const CONNECT_REFUSED = /^curl: \(7\)/
const CONNECT_TIMEOUT = /^curl: \(28\) (Connection timed out|Failed to connect)/
const UNRESOLVED = /^curl: \(6\)|Resolving timed out/

export async function proveFence({ box, spec, timeoutMs = TIMEOUT_MS }: { box: Sandboxes; spec: Omit<SandboxSpec, 'entrypoint' | 'command' | 'net'>; timeoutMs?: number }): Promise<FenceReport> {
  if (box.name !== 'gvisor') return { ok: true, sandbox: box.name, skipped: `${box.name} agents run as the user, with no network fence`, checks: [] }
  const listener = createServer((sock) => sock.end('HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n')).listen(0, '0.0.0.0')
  await once(listener, 'listening')
  const probes = probesFor({ host: `10.200.${FENCE_NET}.1`, hostPort: (listener.address() as AddressInfo).port, lan: hostAddress(isPrivate, '10.0.0.1'), tailnet: hostAddress(isCgnat, '100.64.0.1') })
  let timer: NodeJS.Timeout | undefined
  const probe = async () => {
    await box.create({ ...spec, entrypoint: '/usr/bin/env', command: ['sleep', String(timeoutMs / 1000)], net: FENCE_NET })
    await box.start(spec.id)
    const timeout = new Promise<string>((done) => { timer = setTimeout(() => done(`timed out after ${timeoutMs / 1000} s`), timeoutMs) })
    return Promise.race([box.exec({ id: spec.id, command: ['/bin/sh', '-c', scriptOf(probes)] }).then((run) => text(run.stdout)), timeout])
  }
  const out = await probe().catch((e: unknown) => `sandbox failed: ${errorText(e)}`)
    .finally(() => {
      clearTimeout(timer)
      listener.close()
      return box.remove(spec.id).catch(() => undefined)
    })
  return reportOf({ sandbox: box.name, probes, out })
}

export function probesFor({ host, hostPort, lan, tailnet }: { host: string; hostPort: number; lan: string; tailnet: string }): Probe[] {
  return [
    { name: 'private address', target: `https://${lan}/`, expect: 'refused' },
    { name: 'cloud metadata', target: 'https://169.254.169.254/', expect: 'refused' },
    { name: 'tailnet address', target: `https://${tailnet}/`, expect: 'refused' },
    { name: 'host listener', target: `http://${host}:${hostPort}/`, expect: 'refused' },
    { name: 'public https', target: 'https://example.com/', expect: 'allowed' },
    { name: 'gateway', target: `http://${host}:${config.gatewayPort}/`, expect: 'allowed', waits: true },
  ]
}

export function scriptOf(probes: Probe[]) {
  const lines = probes.map((p, i) => `(printf '${i} %s\\n' "$(curl -sS -m ${PROBE_SECONDS}${p.waits ? ' --retry 15 --retry-connrefused --retry-delay 1' : ''} -w ' =>%{http_code}' '${p.target}' 2>&1 | tail -c 300 | tr -c '[:print:]' ' ')") &`)
  return [...lines, 'wait'].join('\n')
}

export function reportOf({ sandbox, probes, out }: { sandbox: string; probes: Probe[]; out: string }): FenceReport {
  const answers = new Map(out.split('\n').map((line) => /^(\d+) (.*)$/.exec(line)).filter((m) => m !== null).map((m) => [Number(m[1]), m[2]]))
  const checks = probes.map((p, i) => {
    const answer = answers.get(i)
    const { got, reached, refused } = answer === undefined ? { got: out.trim().split('\n').at(-1) || 'no answer', reached: false, refused: false } : verdict(answer)
    return { ...p, got, pass: p.expect === 'allowed' ? reached : refused }
  })
  return { ok: checks.every((c) => c.pass), sandbox, checks }
}

export function verdict(answer: string) {
  const code = Number(STATUS.exec(answer)?.[1] ?? 0)
  if (code >= 100) return { got: `HTTP ${code}`, reached: true, refused: false }
  const error = CURL_ERROR.exec(answer)?.[0].trim()
  if (!error) return { got: answer.replace(STATUS, '').trim() || 'no response', reached: false, refused: false }
  const timedOut = CONNECT_TIMEOUT.test(error)
  const failed = timedOut || CONNECT_REFUSED.test(error)
  return { got: error, reached: !failed && !UNRESOLVED.test(error), refused: timedOut }
}

export function fenceLines(report: FenceReport): string[] {
  if (report.skipped) return [`fence: skipped (${report.skipped})`]
  const passed = report.checks.filter((c) => c.pass).length
  return [
    ...report.checks.map((c) => `fence: ${c.pass ? 'pass' : 'FAIL'} ${c.name} ${c.target} expect ${c.expect}, got ${c.got}`),
    `fence: ${report.ok ? 'ok' : 'NOT OK'} on ${report.sandbox} (${passed}/${report.checks.length} checks passed)`,
  ]
}

function hostAddress(match: (ip: string) => boolean, fallback: string) {
  return Object.values(networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal && match(a.address))?.address ?? fallback
}

function isPrivate(ip: string) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)
}

function isCgnat(ip: string) {
  return /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)
}
