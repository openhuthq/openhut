import type { Computer } from '@openhut/client'

export const ADMIN_TIMEOUT_MS = 8000

export async function adminsOf<A>({ computers, read, timeoutMs = ADMIN_TIMEOUT_MS }: { computers: Computer[]; read: (id: string) => Promise<A | undefined>; timeoutMs?: number }) {
  const settled = await Promise.allSettled(computers.map((computer) => computer.online ? within({ promise: read(computer.id), ms: timeoutMs }) : undefined))
  return computers.map((computer, index) => {
    const result = settled[index]
    return { computer, admin: result.status === 'fulfilled' ? result.value : undefined }
  })
}

function within<A>({ promise, ms }: { promise: Promise<A | undefined>; ms: number }) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms) })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}
