import { test } from 'node:test'
import { Readable } from 'node:stream'
import assert from 'node:assert/strict'
import { fenceLines, probesFor, proveFence, reportOf, scriptOf, verdict } from '../../src/agentd/fence.ts'
import { boxes, memory } from '../../src/agentd/sandbox/memory.ts'
import type { Sandboxes } from '../../src/agentd/sandbox/sandbox.ts'

const probes = probesFor({ host: '127.0.0.1', hostPort: 50123, lan: '192.168.0.43', tailnet: '100.64.0.1' })
const spec = { id: 'fence', image: 'img', cpus: 1, memoryMib: 256, user: '10000:10000', env: {}, mounts: [], tmpfs: [], labels: {} }

const REFUSED_7 = 'curl: (7) Failed to connect to 10.0.0.1 port 443 after 0 ms: Could not connect to server'
const TIMED_OUT = 'curl: (28) Connection timed out after 6001 milliseconds'

test('an HTTP status, or any error after the connection was made, is a reached target', () => {
  assert.deepEqual(verdict({ answer: '{"error":"unauthorized"} =>401', sandbox: 'gvisor' }), { got: 'HTTP 401', reached: true, refused: false })
  for (const error of ['curl: (52) Empty reply from server', 'curl: (56) Recv failure: Connection reset by peer', 'curl: (28) Operation timed out after 6001 milliseconds with 0 bytes received', 'curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to 10.0.0.1:443', 'curl: (60) SSL certificate problem: self-signed certificate']) {
    for (const sandbox of ['gvisor', 'native']) assert.deepEqual(verdict({ answer: `${error} =>000`, sandbox }), { got: error, reached: true, refused: false })
  }
})

test('on gVisor only a dropped connection is refused; a reset means something answered', () => {
  assert.deepEqual(verdict({ answer: `${TIMED_OUT} =>000`, sandbox: 'gvisor' }), { got: TIMED_OUT, reached: false, refused: true })
  assert.deepEqual(verdict({ answer: 'curl: (28) Failed to connect to 10.0.0.1 port 443 after 6002 ms: Timeout was reached =>000', sandbox: 'gvisor' }).refused, true)
  assert.deepEqual(verdict({ answer: `${REFUSED_7} =>000`, sandbox: 'gvisor' }), { got: REFUSED_7, reached: false, refused: false })
})

test('on native a policy denial or a failed connection is refused', () => {
  assert.deepEqual(verdict({ answer: `${REFUSED_7} =>000`, sandbox: 'native' }), { got: REFUSED_7, reached: false, refused: true })
  assert.deepEqual(verdict({ answer: `${TIMED_OUT} =>000`, sandbox: 'native' }), { got: TIMED_OUT, reached: false, refused: true })
  assert.deepEqual(verdict({ answer: '{"code":"network_policy_denied","domain":"169.254.169.254","message":"Request blocked by network policy."} =>403', sandbox: 'native' }), { got: 'HTTP 403 network_policy_denied', reached: false, refused: true })
})

test('a probe that never ran curl, or never resolved its host, is neither reached nor refused', () => {
  assert.deepEqual(verdict({ answer: '/bin/sh: 1: curl: not found', sandbox: 'gvisor' }), { got: '/bin/sh: 1: curl: not found', reached: false, refused: false })
  assert.deepEqual(verdict({ answer: 'curl: (6) Could not resolve host: 127.0.0.1 =>000', sandbox: 'native' }), { got: 'curl: (6) Could not resolve host: 127.0.0.1', reached: false, refused: false })
})

test('the report passes only when every refused target is refused and every allowed one answers', () => {
  const out = ['0 curl: (7) Failed =>000', '1 network_policy_denied =>403', '2 curl: (28) Connection timed out =>000', '3 curl: (7) Failed =>000', '4 <html></html> =>200', '5 {} =>401', ''].join('\n')
  const report = reportOf({ sandbox: 'native', probes, out })
  assert.equal(report.ok, true)
  assert.deepEqual(report.checks.map((c) => c.pass), [true, true, true, true, true, true])
  const leaky = reportOf({ sandbox: 'native', probes, out: out.replace('3 curl: (7) Failed =>000', '3 ok =>200') })
  assert.equal(leaky.ok, false)
  assert.deepEqual(leaky.checks[3], { name: 'host listener', target: 'http://127.0.0.1:50123/', expect: 'refused', got: 'HTTP 200', pass: false })
})

test('a missing answer fails its check with the last line of output', () => {
  const report = reportOf({ sandbox: 'gvisor', probes, out: 'timed out after 30 s' })
  assert.equal(report.ok, false)
  assert.ok(report.checks.every((c) => !c.pass && c.got === 'timed out after 30 s'))
})

test('the script probes every target in parallel and numbers each answer', () => {
  const script = scriptOf(probes)
  for (const [i, p] of probes.entries()) assert.ok(script.includes(`printf '${i} %s\\n'`) && script.includes(`'${p.target}'`))
  assert.ok(script.endsWith('\nwait'))
})

test('the host probe targets a listener agentd really holds open, so only the fence can make it fail', async () => {
  let target = ''
  const box: Sandboxes = { ...memory, name: 'native', exec: async ({ command }) => {
    target = /'(http:\/\/127\.0\.0\.1:\d+\/)'/.exec(command.at(-1) ?? '')?.[1] ?? ''
    const answer = await fetch(target.replace('127.0.0.1', '127.0.0.1')).then((r) => `HTTP ${r.status}`, (e: Error) => e.message)
    return { stdin: null, stdout: Readable.from([`3 ${answer} =>${answer.slice(5)}\n`]), exit: Promise.resolve(0), kill: () => undefined }
  } }
  const report = await proveFence({ box, spec })
  assert.ok(target)
  assert.deepEqual(report.checks[3], { name: 'host listener', target, expect: 'refused', got: 'HTTP 200', pass: false })
})

test('the memory sandbox is skipped, not proven', async () => {
  const report = await proveFence({ box: memory, spec })
  assert.deepEqual(report, { ok: true, sandbox: 'memory', skipped: 'memory sandbox has no network', checks: [] })
  assert.deepEqual(fenceLines(report), ['fence: skipped (memory sandbox has no network)'])
})

test('a sandbox that never answers is reported as a timeout, not waited on, and removed', async () => {
  const box: Sandboxes = { ...memory, name: 'native', exec: () => new Promise(() => {}) }
  const report = await proveFence({ box, spec, timeoutMs: 50 })
  assert.equal(report.ok, false)
  assert.equal(report.checks[0].got, 'timed out after 0.05 s')
  assert.match(fenceLines(report).at(-1) ?? '', /^fence: NOT OK on native \(0\/6 checks passed\)$/)
  assert.equal(boxes.has('fence'), false)
})

test('a sandbox that fails to start fails every check with its error', async () => {
  const box: Sandboxes = { ...memory, name: 'gvisor', create: () => Promise.reject(new Error('runsc is missing')) }
  const report = await proveFence({ box, spec })
  assert.equal(report.ok, false)
  assert.ok(report.checks.every((c) => c.got === 'sandbox failed: runsc is missing'))
  assert.ok(report.checks.some((c) => c.target === 'http://10.200.0.1:8081/'))
})

test('on native the proxy refusing a CONNECT counts as refused', () => {
  const denied = 'curl: (56) CONNECT tunnel failed, response 403'
  assert.deepEqual(verdict({ answer: `${denied} =>000`, sandbox: 'native' }), { got: denied, reached: false, refused: true })
})
