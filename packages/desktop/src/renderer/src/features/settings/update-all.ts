import type { Admin, Update } from '@openhut/common/admin/admin.ts'

export type Behind = { id: string; name: string }
export type Outcome = { id: string; name: string; ok: boolean; reason: string | null }
type Steps = {
  start: (server: Behind) => Promise<Update>
  read: (server: Behind) => Promise<Admin | undefined>
  say: (text: string) => void
  wait: () => Promise<void>
  limit: number
}

export function behind({ computers, admins }: { computers: { id: string; name: string; url: string; online: boolean }[]; admins: { computer: { id: string }; admin: Admin | undefined }[] }): Behind[] {
  return computers.filter((computer) => !!computer.url && computer.online && admins.find((each) => each.computer.id === computer.id)?.admin?.server.updateAvailable)
    .map(({ id, name }) => ({ id, name }))
}

export async function updateServers({ servers, steps }: { servers: Behind[]; steps: Steps }): Promise<Outcome[]> {
  const outcomes: Outcome[] = []
  for (const server of servers) {
    steps.say(`Updating ${server.name}…`)
    outcomes.push(await updateOne({ server, steps }))
  }
  return outcomes
}

async function updateOne({ server, steps }: { server: Behind; steps: Steps }): Promise<Outcome> {
  const started = await steps.start(server).catch((error: unknown) => error instanceof Error ? error : new Error(String(error)))
  if (started instanceof Error) return { ...server, ok: false, reason: started.message }
  for (let tries = 0; tries < steps.limit; tries++) {
    await steps.wait()
    const admin = await steps.read(server).catch(() => undefined)
    if (!admin) continue
    if (admin.server.update?.status === 'failed') return { ...server, ok: false, reason: admin.server.update.reason ?? 'The update stopped before it finished.' }
    if (!admin.server.update && admin.server.build === started.to) return { ...server, ok: true, reason: null }
  }
  return { ...server, ok: false, reason: 'It didn\'t finish in time. Settings › Computers shows when it does.' }
}
