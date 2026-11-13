import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.CONSOLE_DATA = mkdtempSync(join(tmpdir(), 'jakebox-console-test-'))
process.env.CONSOLE_PUBLISH_KEY = 'test-publish-key'
process.env.PORT = '0'
