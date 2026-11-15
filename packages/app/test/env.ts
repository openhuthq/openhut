import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.OPENHUT_DATA = mkdtempSync(join(tmpdir(), 'openhut-test-'))
process.env.AGENTD_SOCK = join(process.env.OPENHUT_DATA, 'no-agentd.sock')
process.env.SETUP_CODE = 'test-setup-code'
process.env.OPENHUT_MODEL = 'test'
process.env.OPENHUT_AGENT_API = 'http://127.0.0.1:18649'
