import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../../../../..')
const RUNTIME = process.env.AGENTD_HERMES ?? ''
const PYTHON = join(RUNTIME, 'python/bin/python3')

test('the openhut-ui plugin points Slack\'s client and file downloads at the gateway', { skip: !existsSync(PYTHON) && 'no Hermes runtime (set AGENTD_HERMES)' }, () => {
  const stub = mkdtempSync(join(tmpdir(), 'slack-plugin-'))
  mkdirSync(join(stub, 'gateway'))
  writeFileSync(join(stub, 'gateway/__init__.py'), '')
  writeFileSync(join(stub, 'gateway/session_context.py'), 'def get_session_env(name):\n    return None\n')
  const out = execFileSync(PYTHON, [join(import.meta.dirname, 'fixtures/slack-broker.py'), join(ROOT, 'vendor/hermes-plugins/openhut-ui/__init__.py'), stub], { env: { ...process.env, PYTHONPATH: `${join(RUNTIME, 'site')}:${stub}` }, encoding: 'utf8' })
  assert.match(out, /slack broker plugin ok/)
})
