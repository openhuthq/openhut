import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.FASTMONKEY_DATA = mkdtempSync(join(tmpdir(), 'fastmonkey-test-'))
process.env.AGENTD_SOCK = join(process.env.FASTMONKEY_DATA, 'no-agentd.sock')
process.env.SETUP_CODE = 'test-setup-code'
process.env.FASTMONKEY_MODEL = 'test'
process.env.FASTMONKEY_AGENT_API = 'http://127.0.0.1:18642'
