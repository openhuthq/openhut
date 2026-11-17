import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const BRIDGE = new URL('../bin/openhut-mcp', import.meta.url).pathname
const SERVER = new URL('../../runtime/src/server/app.ts', import.meta.url).pathname

function bridge({ home, args = [], lines }: { home: string; args?: string[]; lines: unknown[] }): Promise<Record<string, unknown>[]> {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', [BRIDGE, ...args], { env: { ...process.env, OPENHUT_HOME: home }, stdio: ['pipe', 'pipe', 'inherit'] })
    let out = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => { out += chunk })
    child.on('close', () => resolve(out.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))))
    child.stdin.end(lines.map((line) => `${JSON.stringify(line)}\n`).join(''))
  })
}

const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }

test('the sh bridge carries MCP between stdio and the runtime socket, and says when the app is closed', async () => {
  const home = mkdtempSync(join(tmpdir(), 'oh-mcp-'))
  const server = spawn(process.execPath, [SERVER], { env: { ...process.env, OPENHUT_DATA: join(home, 'data'), OPENHUT_SOCKET: join(home, 'server.sock'), AGENTD_SOCK: join(home, 'none.sock'), OPENHUT_MODEL: 'test', OPENHUT_GATEWAY_PORT: '0' }, stdio: 'ignore' })
  try {
    for (let i = 0; i < 150 && !existsSync(join(home, 'server.sock')); i++) await sleep(100)
    const answers = await bridge({ home, lines: [INIT, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }] })
    assert.deepEqual(answers.map((each) => each.id), [1, 2])
    const tools = (answers[1]?.result as { tools: { name: string }[] }).tools.map((tool) => tool.name)
    assert.ok(tools.includes('list_agents') && tools.includes('update_agent'), tools.join(', '))
    const closed = await bridge({ home, args: ['--computer', 'beelink'], lines: [{ ...INIT, id: 7 }] })
    assert.deepEqual(closed, [{ jsonrpc: '2.0', id: 7, error: { code: -32603, message: 'The OpenHut app isn\'t running, and it holds the key for that computer. Open the OpenHut app, then try again.' } }])
  } finally {
    server.kill('SIGKILL')
  }
})
