import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, connect, type Socket } from 'node:net'
import { once } from 'node:events'
import { PassThrough } from 'node:stream'
import { downLine, FREE_POLICY, HELD_POLICY, live } from '../../src/agentd/browser.ts'
import type { Exec } from '../../src/agentd/sandbox/sandbox.ts'

test('while a person holds the browser the agent may look but not act', () => {
  const held = JSON.parse(HELD_POLICY)
  assert.equal(held.default, 'deny')
  for (const look of ['snapshot', 'url', 'title', 'gettext', 'screenshot', 'stream_status']) assert.ok(held.allow.includes(look), look)
  for (const act of ['navigate', 'click', 'fill', 'eval', 'scroll', 'press', 'type']) assert.ok(!held.allow.includes(act), act)
  assert.deepEqual(JSON.parse(FREE_POLICY), { default: 'allow' })
})

test('the viewer gets frames and page changes as they are, commands without their arguments, results without their data, and nothing else', () => {
  const frame = '{"data":"/9j/4AAQ","seq":3,"type":"frame"}'
  assert.equal(downLine(frame), frame)
  assert.equal(downLine('{"type":"url","url":"https://example.com/"}'), '{"type":"url","url":"https://example.com/"}')
  assert.deepEqual(JSON.parse(downLine('{"type":"command","action":"fill","params":{"selector":"#password","value":"hunter2","url":"https://a.test/"}}') ?? ''), { type: 'command', id: '', action: 'fill', url: 'https://a.test/' })
  assert.deepEqual(JSON.parse(downLine('{"type":"result","id":"r1","action":"gettext","success":true,"data":{"text":"the whole page"}}') ?? ''), { type: 'result', id: 'r1' })
  assert.equal(downLine('{"type":"console","text":"hi"}'), undefined)
  assert.equal(downLine(''), undefined)
  assert.equal(downLine('not json'), undefined)
})

test('acks always reach the bridge; input only from the viewer holding the browser; letting go frees the agent', async (t) => {
  const { viewer: watcher, bridge: watched } = await open('ag_watch001')
  const { viewer: holder, bridge, policy } = await open('ag_watch001')
  t.after(() => { watcher.destroy(); holder.destroy() })
  assert.deepEqual(await nextLine(holder), { type: 'hold', held: false })
  await nextLine(watcher)
  holder.write('{"type":"ack","seq":7}\n{"type":"input_mouse","eventType":"mousePressed","x":1,"y":2}\n')
  assert.deepEqual(await nextLine(bridge), { type: 'ack', seq: 7 })
  holder.write('{"type":"hold","held":true}\n')
  assert.deepEqual(await nextLine(watcher), { type: 'hold', held: true })
  assert.deepEqual(policy, [true])
  watcher.write('{"type":"input_keyboard","eventType":"keyDown","key":"a"}\n')
  holder.write('{"type":"input_keyboard","eventType":"keyDown","key":"b"}\n')
  assert.equal((await nextLine(bridge)).key, 'b')
  assert.equal(watched.readableLength, 0)
  holder.destroy()
  assert.deepEqual(await nextLine(watcher), { type: 'hold', held: false })
  assert.deepEqual(policy, [true, false])
})

async function open(id: string) {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const exec: Exec = { stdin, stdout, exit: new Promise(() => undefined), kill: () => undefined }
  const policy: boolean[] = []
  const server = createServer((sock: Socket) => live({ id, sock, bridge: exec, rest: '', setHeld: (held) => policy.push(held) })).listen(0)
  await once(server, 'listening')
  const address = server.address()
  const viewer = connect(typeof address === 'object' && address ? address.port : 0)
  viewer.on('close', () => server.close())
  viewer.setEncoding('utf8')
  return { viewer, bridge: stdin, policy }
}

async function nextLine(stream: Socket | PassThrough): Promise<Record<string, unknown>> {
  for (;;) {
    const chunk = stream.read()
    if (chunk !== null) {
      const text = String(chunk)
      const end = text.indexOf('\n')
      if (end + 1 < text.length) stream.unshift(text.slice(end + 1))
      return JSON.parse(text.slice(0, end))
    }
    await once(stream, 'readable')
  }
}
