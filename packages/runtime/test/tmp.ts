import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Each test process gets its own TMPDIR, removed on exit, so every mkdtemp(tmpdir()) in a test is cleaned up.
// Child processes inherit it. A test killed with SIGKILL still leaks its folder.
const dir = mkdtempSync(join(tmpdir(), 'oht-'))
process.env.TMPDIR = dir
process.on('exit', () => rmSync(dir, { recursive: true, force: true }))
