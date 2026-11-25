import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { text } from 'node:stream/consumers'
import type { SandboxSpec } from '../../../src/agentd/sandbox/sandbox.ts'

process.env.OPENHUT_SANDBOX ||= 'memory'
const { sandboxes } = await import('../../../src/agentd/sandbox/index.ts')
const box = await sandboxes()
const { ok, reason } = await box.ready()
const skip = ok ? false : `${box.name} is not ready: ${reason}`
const real = box.name !== 'memory'
const id = `ct-${randomBytes(4).toString('hex')}`
const unknown = `ct-missing-${randomBytes(4).toString('hex')}`
const LABELS = { 'openhut.contract': id }

const spec = (over: Partial<SandboxSpec> = {}): SandboxSpec => ({
  id, image: 'alpine:3.20', cpus: 1, memoryMib: 256, user: 'root', entrypoint: '/bin/sleep', command: ['3600'],
  env: { CONTRACT: '1' }, mounts: [], tmpfs: [{ guest: '/tmp', sizeMib: 16 }], labels: LABELS, net: 254, ...over,
})

const find = async (each: string) => (await box.list()).find((state) => state.id === each)

after(() => box.remove(id).catch(() => undefined))

test(`${box.name}: ready() says ok`, { skip }, () => {
  assert.equal(ok, true)
})

test(`${box.name}: create lists the sandbox stopped with its labels`, { skip }, async () => {
  await box.create(spec())
  const state = await find(id)
  assert.ok(state)
  assert.equal(state.running, false)
  assert.equal(state.labels['openhut.contract'], id)
})

test(`${box.name}: start runs it with a startedAt`, { skip }, async () => {
  await box.start(id)
  const state = await find(id)
  assert.equal(state?.running, true)
  assert.ok(state.startedAt && !Number.isNaN(Date.parse(state.startedAt)))
})

test(`${box.name}: exec gives back stdout and the exit code`, { skip }, async () => {
  const proc = await box.exec({ id, command: ['sh', '-c', 'echo hi; exit 3'] })
  const [stdout, code] = await Promise.all([text(proc.stdout), proc.exit])
  if (real) assert.deepEqual({ stdout, code }, { stdout: 'hi\n', code: 3 })
  else assert.equal(typeof code, 'number')
})

test(`${box.name}: exec pipes stdin through`, { skip }, async () => {
  const proc = await box.exec({ id, command: ['cat'], stdin: true })
  assert.ok(proc.stdin)
  proc.stdin.end('piped\n')
  const [stdout, code] = await Promise.all([text(proc.stdout), proc.exit])
  if (real) assert.deepEqual({ stdout, code }, { stdout: 'piped\n', code: 0 })
  else assert.equal(code, 0)
})

test(`${box.name}: run runs the entrypoint with the command as its arguments`, { skip }, async () => {
  const result = await box.run({ spec: spec({ id: `${id}-run`, entrypoint: '/bin/sh', command: [] }), command: ['-c', 'echo ran; exit 4'] })
  if (real) assert.deepEqual(result, { code: 4, stdout: 'ran\n' })
  else assert.deepEqual(Object.keys(result).sort(), ['code', 'stdout'])
  assert.equal(await find(`${id}-run`), undefined)
})

test(`${box.name}: run has no network, even with a net in its spec, though the same probe reaches the internet from the running sandbox`, { skip: skip || (!real && 'the memory sandbox runs nothing') }, async () => {
  const probe = 'nc -z -w 3 1.1.1.1 443 && echo reached || echo unreachable'
  const networked = await box.exec({ id, command: ['sh', '-c', probe] })
  assert.equal(await text(networked.stdout), 'reached\n')
  const { stdout } = await box.run({ spec: spec({ id: `${id}-run`, entrypoint: '/bin/sh', command: [] }), command: ['-c', probe] })
  assert.equal(stdout, 'unreachable\n')
})

test(`${box.name}: stop leaves it listed and not running`, { skip }, async () => {
  await box.stop({ id, seconds: 1 })
  const state = await find(id)
  assert.ok(state)
  assert.equal(state.running, false)
})

test(`${box.name}: start again runs it again`, { skip }, async () => {
  await box.start(id)
  assert.equal((await find(id))?.running, true)
})

test(`${box.name}: remove takes it out of the list`, { skip }, async () => {
  await box.remove(id)
  assert.equal(await find(id), undefined)
})

test(`${box.name}: remove of an unknown id resolves`, { skip }, async () => {
  await box.remove(unknown)
  await box.remove(id)
})

test(`${box.name}: start and stop of an unknown id reject`, { skip }, async () => {
  await assert.rejects(box.start(unknown))
  await assert.rejects(box.stop({ id: unknown, seconds: 1 }))
})
