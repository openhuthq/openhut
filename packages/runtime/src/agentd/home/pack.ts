import { spawn } from 'node:child_process'
import { lchownSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const MAX_HOME_BYTES = 100 << 20
export const MAX_HOME_BASE64 = Math.ceil(MAX_HOME_BYTES / 3) * 4

export async function packHome(dir: string): Promise<string> {
  return (await tar({ args: ['-czf', '-', '-C', dir, '.'] })).toString('base64')
}

export async function unpackHome({ dir, tar: packed, owner }: { dir: string; tar: string; owner?: { uid: number; gid: number } }): Promise<void> {
  await tar({ args: ['-xzf', '-', '-C', dir], input: Buffer.from(packed, 'base64') })
  if (owner === undefined) return
  lchownSync(dir, owner.uid, owner.gid)
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) lchownSync(join(entry.parentPath, entry.name), owner.uid, owner.gid)
}

function tar({ args, input }: { args: string[]; input?: Buffer }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', args, { env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    let size = 0
    let errors = ''
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_HOME_BYTES) child.kill()
      else out.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => { errors += chunk })
    child.stdin.on('error', () => undefined)
    child.on('error', reject)
    child.on('close', (code) => {
      if (size > MAX_HOME_BYTES) return reject(new Error(`the agent's home is over ${MAX_HOME_BYTES >> 20} MB packed, too big to move`))
      if (code !== 0) return reject(new Error(errors.trim() || `tar exited with ${code}`))
      resolve(Buffer.concat(out))
    })
    child.stdin.end(input)
  })
}
