import { createHash } from 'node:crypto'

export function reacher({ connect, relayUrl, key, legacy }) {
  const sessions = new Map()
  const open = (computer) => {
    if (!sessions.has(computer.id)) {
      const opening = key().then((device) => connect({ relayUrl, computer: { id: relayId(computer.key), key: computer.key }, key: device }))
      const gone = () => { if (sessions.get(computer.id) === opening) sessions.delete(computer.id) }
      opening.then(async (tunnel) => {
        for await (const _ of tunnel.control);
        gone()
      }, gone)
      sessions.set(computer.id, opening)
    }
    return sessions.get(computer.id)
  }
  const drop = (id) => {
    sessions.get(id)?.then((tunnel) => tunnel.close(), () => undefined)
    sessions.delete(id)
  }
  const reach = async ({ computer, path, init }) => {
    if (!computer.key) return legacy({ computer, path, init })
    try {
      return await (await open(computer)).fetch(path, init)
    } catch (error) {
      drop(computer.id)
      if (computer.url) return legacy({ computer, path, init })
      throw new Error(error?.type === 'offline' ? `${computer.name} is offline.` : `${computer.name} isn't answering.`)
    }
  }
  const socket = async ({ computer, path }) => {
    try {
      return (await open(computer)).socket(path)
    } catch (error) {
      drop(computer.id)
      throw error
    }
  }
  return { reach, socket, drop }
}

export function relayId(key) {
  return createHash('sha256').update(Buffer.from(key, 'hex')).digest('hex')
}
