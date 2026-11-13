import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.JAKEBOX_DATA = mkdtempSync(join(tmpdir(), 'jakebox-test-'))
process.env.AGENTD_SOCK = join(process.env.JAKEBOX_DATA, 'no-agentd.sock')
process.env.SETUP_CODE = 'test-setup-code'
process.env.JAKEBOX_MODEL = 'test'
