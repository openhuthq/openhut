#!/usr/bin/env node
import { request } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const home = join(homedir(), process.platform === 'darwin' ? 'Library/Application Support' : '.config', /\/resources\/backend\//i.test(import.meta.url) ? 'OpenHut' : 'OpenHut Dev')
const flag = process.argv.indexOf('--computer')
const computer = flag < 0 ? 'local' : process.argv[flag + 1] ?? ''
const local = computer === 'local'
const socketPath = local ? process.env.OPENHUT_SOCKET ?? join(home, 'server.sock') : process.env.OPENHUT_MCP_SOCKET ?? join(home, 'mcp.sock')
const path = local ? '/mcp' : `/c/${encodeURIComponent(computer)}/mcp`
const down = local ? 'OpenHut isn\'t running' : 'The OpenHut app isn\'t running, and it holds the key for that computer'

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  const id = idOf(line)
  const fail = (message) => {
    if (id !== undefined) process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message } })}\n`)
  }
  const call = request({ socketPath, path, method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' } }, (res) => {
    let body = ''
    res.setEncoding('utf8').on('data', (chunk) => { body += chunk }).on('end', () => {
      if (res.statusCode >= 400) return fail(`OpenHut answered ${res.statusCode}: ${body}`)
      if (body.trim()) process.stdout.write(`${body.trim()}\n`)
    })
  })
  call.on('error', (err) => fail(`${down} (${err.message}). Open the OpenHut app, then try again.`))
  call.end(line)
})

function idOf(line) {
  try {
    return JSON.parse(line).id
  } catch {
    return null
  }
}
