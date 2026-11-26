import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../../../../..')

test('the openhut-ui plugin\'s post_message asks the gateway for the target and posts through Hermes\'s send_message', () => {
  const stub = mkdtempSync(join(tmpdir(), 'post-plugin-'))
  for (const dir of ['gateway', 'tools']) {
    mkdirSync(join(stub, dir))
    writeFileSync(join(stub, dir, '__init__.py'), '')
  }
  writeFileSync(join(stub, 'gateway/session_context.py'), 'def get_session_env(name):\n    return None\n')
  writeFileSync(join(stub, 'tools/send_message_tool.py'), 'import json\nsent = []\n\ndef send_message_tool(args, **kw):\n    sent.append(args)\n    return json.dumps({"success": True})\n')
  const out = execFileSync('python3', [join(import.meta.dirname, 'fixtures/post-message.py'), join(ROOT, 'vendor/hermes-plugins/openhut-ui/__init__.py')], { env: { ...process.env, PYTHONPATH: stub }, encoding: 'utf8' })
  assert.match(out, /deny {2}\{"error": "You can only post in your own channels/)
  assert.match(out, /plugin post_message check ok/)
})
