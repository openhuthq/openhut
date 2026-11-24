import type { Team } from '@openhut/common/cloud/openhut-cloud.ts'
import { inviteId, roomKeys as rooms, type Cloudside } from '@openhut/common/keyring/rooms.ts'
import { cloud, sending } from '../platform/cloud.ts'

export { inviteId, type Cloudside }

function teamOf(ws: string): Cloudside {
  const team: Team = cloud.team(ws)
  return { ...team, send: async (letter) => { sending(ws); return team.send(letter) } }
}

export const roomKeys = {
  ...rooms,
  refresh: ({ ws, team = teamOf(ws) }: { ws: string; team?: Cloudside }) => rooms.refresh({ ws, team }),
  rekey: ({ ws, team = teamOf(ws) }: { ws: string; team?: Cloudside }) => rooms.rekey({ ws, team }),
}
