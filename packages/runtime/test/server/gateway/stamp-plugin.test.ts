import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const PLUGIN = resolve(import.meta.dirname, '../../../../../vendor/hermes-plugins/openhut-ui/__init__.py')

test('the openhut-ui plugin stamps the chat on every openhut tool, and on nothing else', () => {
  const stub = mkdtempSync(join(tmpdir(), 'stamp-plugin-'))
  mkdirSync(join(stub, 'gateway'))
  writeFileSync(join(stub, 'gateway/__init__.py'), '')
  writeFileSync(join(stub, 'gateway/session_context.py'), 'def get_session_env(name):\n    return {"HERMES_SESSION_PLATFORM": "slack", "HERMES_SESSION_CHAT_ID": "C1"}.get(name)\n')
  const script = 'import importlib.util, json, sys\nspec = importlib.util.spec_from_file_location("plug", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\nprint(json.dumps([m.stamp(tool_name=name) for name in ("mcp__openhut__list_routines", "mcp__openhut__any_new_tool", "terminal", "mcp__github__list_routines")]))'
  const out = JSON.parse(execFileSync('python3', ['-c', script, PLUGIN], { env: { ...process.env, PYTHONPATH: stub }, encoding: 'utf8' }))
  const stamped = { action: 'modify', args: { origin: { platform: 'slack', chat_id: 'C1' } } }
  assert.deepEqual(out, [stamped, stamped, null, null])
})
