import type { CloudInvite, CreateCloudInvite } from '@openhut/common/cloud/cloud.ts'
import { cloud } from '../platform/cloud.ts'
import { HttpError } from '../platform/http-error.ts'
import { mustBeOn, putList } from './cloud-service.ts'
import { roomKeys } from './room-keys.ts'
import { cloudEvents } from './cloud-events.ts'

export const inviteService = {
  async inviteToCloud({ workspace, email, role }: CreateCloudInvite): Promise<CloudInvite> {
    const made = await roomKeys.invite({ ws: mustBeOn(workspace), email, role, name: cloudEvents.name(workspace) })
    await putList({ workspace, list: made.list })
    const posted = await cloud.team(workspace).invite({ id: made.id, email, role, key: made.key, body: made.body, link: made.link })
    if (posted.status !== 200) throw new HttpError(502, `OpenHut Cloud didn’t send the invite (HTTP ${posted.status}). Try again.`)
    await roomKeys.keepLink({ ws: workspace, email, link: made.link, until: made.expiresAt })
    return { object: 'cloud_invite', id: made.id, workspace, email, role, link: made.link, expiresAt: made.expiresAt }
  },
}
