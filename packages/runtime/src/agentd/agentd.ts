import { mkdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname } from 'node:path'
import { config } from './config.ts'
import { APP_GID, own } from './host.ts'
import { boot, serve } from './serve.ts'

await boot()
mkdirSync(dirname(config.socket), { recursive: true })
rmSync(config.socket, { force: true })
export const server = createServer({ allowHalfOpen: true }, serve).listen(config.socket, () => {
  own({ path: config.socket, uid: 0, gid: APP_GID, mode: 0o660 })
  console.log(`agentd on ${config.socket}`)
})
