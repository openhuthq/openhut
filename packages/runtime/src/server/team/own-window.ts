import * as z from 'zod/mini'
import { DeviceKey } from '@openhut/common/cloud/cloud.ts'
import type { JoinCode } from '@openhut/common/cloud/v1/identity.ts'
import { cloudService, putList } from '../cloud/cloud-service.ts'
import { deviceName, keysService } from '../cloud/keys-service.ts'
import { roomKeys } from '../cloud/room-keys.ts'
import { userPresence } from '../cloud/user-presence.ts'
import { log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { settings } from '../platform/settings.ts'

type Port = { postMessage: (message: unknown) => void; on: (event: 'message', listener: (event: { data: unknown }) => void) => void }
export type WindowJoin = JoinCode & { computer: string }

const Ask = z.object({ type: z.literal('own-window'), id: z.string(), key: z.string() })
const parent: Port | undefined = Reflect.get(process, 'parentPort')

export const ownWindow = {
  async take({ key }: { key: string }): Promise<WindowJoin> {
    if (!DeviceKey.safeParse(key).success) throw new HttpError(400, 'Send the window’s public key as 64 bytes of base64url.', { param: 'key' })
    const ws = keysService.mustBeOn().workspace.id
    const old = settings.ownWindow()
    if (old && old !== key && !await userPresence.ask('make this window your OpenHut window')) throw new HttpError(403, 'Not confirmed. The old window stays your OpenHut window.', { param: 'presence' })
    if (old && old !== key && listed(old)) await putList({ workspace: ws, list: (await roomKeys.teamChange({ ws, devices: [old] })).list })
    const list = await keysService.addDevice({ device: key, name: `${deviceName()} window`, runtime: false })
    if (list) await putList({ workspace: ws, list })
    await settings.setOwnWindow(key)
    log.info({ event: 'window.own', replaced: Boolean(old && old !== key) })
    return { ...await cloudService.joinCode(), computer: await keysService.deviceKey() }
  },

  listen(): void {
    const answer = async (message: unknown) => {
      const ask = z.safeParse(Ask, message).data
      if (!ask) return
      const reply = await ownWindow.take({ key: ask.key }).then((join) => ({ join }), (error: unknown) => ({ error: messageOf(error), status: error instanceof HttpError ? error.status : 500 }))
      const out = { type: 'own-window', id: ask.id, ...reply }
      if (parent) parent.postMessage(out)
      else process.send?.(out)
    }
    if (parent) parent.on('message', (event) => void answer(event.data))
    else process.on('message', (message) => void answer(message))
  },
}

function listed(key: string): boolean {
  return Boolean(roomKeys.members(keysService.mustBeOn().workspace.id)?.members.some((member) => member.devices.includes(key)))
}
