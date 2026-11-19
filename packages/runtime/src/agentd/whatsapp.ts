import { existsSync } from 'node:fs'
import type { Socket } from 'node:net'
import { box } from './host.ts'
import type { Mount } from './sandbox/sandbox.ts'

const BRIDGE = process.env.AGENTD_WHATSAPP_BRIDGE || '/var/lib/openhut/whatsapp-bridge'
const PAIR_COMMAND = ['node', '/opt/data/scripts/whatsapp-bridge/bridge.js', '--pair-only', '--pair-json', '--session', '/opt/data/platforms/whatsapp/session']

export const whatsapp = {
  installed(): boolean {
    return existsSync(`${BRIDGE}/node_modules`)
  },

  mounts(): Mount[] {
    return box.name !== 'native' && whatsapp.installed() ?[{ host: BRIDGE, guest: '/opt/data/scripts/whatsapp-bridge', readOnly: true }] : []
  },

  async pair({ id, sock, running, ended }: { id: string; sock: Socket; running: boolean; ended: () => void }): Promise<undefined> {
    if (!whatsapp.installed()) throw new Error("the WhatsApp bridge isn't installed on this server; run the installer again")
    if (!running) throw new Error("the agent isn't running")
    const proc = await box.exec({ id, command: PAIR_COMMAND })
    proc.stdout.pipe(sock)
    sock.on('close', () => proc.kill())
    sock.on('end', () => sock.destroy())
    sock.on('error', () => sock.destroy())
    sock.resume()
    proc.exit.finally(ended).catch(() => undefined)
    return undefined
  },
}
