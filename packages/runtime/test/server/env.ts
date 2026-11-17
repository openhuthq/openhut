import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.OPENHUT_DATA = mkdtempSync(join(tmpdir(), 'openhut-test-'))
process.env.AGENTD_SOCK = join(process.env.OPENHUT_DATA, 'no-agentd.sock')
process.env.OPENHUT_MODEL = 'test'
process.env.OPENHUT_AGENT_API = 'http://127.0.0.1:18649'
process.env.OPENHUT_CLIENT_KEY_SHA256 = createHash('sha256').update('test-key').digest('hex')
