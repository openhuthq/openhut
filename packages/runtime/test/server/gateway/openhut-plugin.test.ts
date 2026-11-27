import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const PLUGINS = resolve(import.meta.dirname, '../../../../../vendor/hermes-plugins')

test('the openhut plugin registers the tools and hooks its settings list, stamps every openhut tool, forwards each to the gateway, and reconnects the openhut MCP server when the gateway is back', () => {
  const stub = mkdtempSync(join(tmpdir(), 'openhut-plugin-'))
  for (const dir of ['gateway', 'tools']) {
    mkdirSync(join(stub, dir))
    writeFileSync(join(stub, dir, '__init__.py'), '')
  }
  writeFileSync(join(stub, 'gateway/session_context.py'), 'def get_session_env(name):\n    return {"HERMES_SESSION_PLATFORM": "slack", "HERMES_SESSION_CHAT_ID": "C1"}.get(name)\n')
  writeFileSync(join(stub, 'tools/send_message_tool.py'), 'import json\nsent = []\n\ndef send_message_tool(args, **kw):\n    sent.append(args)\n    return json.dumps({"success": True})\n')
  writeFileSync(join(stub, 'tools/mcp_tool_loop.py'), 'reconnects = []\n\ndef reconnect_mcp_server(name):\n    reconnects.append(name)\n    return True\n')
  const out = execFileSync('python3', [join(import.meta.dirname, 'fixtures/openhut-plugin.py')], { env: { ...process.env, PYTHONPATH: `${stub}:${PLUGINS}` }, encoding: 'utf8' })
  assert.match(out, /deny {2}\{"error": "You can only post in your own channels/)
  assert.match(out, /openhut plugin check ok/)
})
