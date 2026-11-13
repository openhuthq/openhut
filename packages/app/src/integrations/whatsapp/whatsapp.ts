import type { Audience } from '@jakebox/common/channels/channel.ts'
import { agentd, type Pairing } from '../../platform/agentd.ts'

export const whatsapp = {
  async pairing({ agentId }: { agentId: string }): Promise<Pairing> {
    return agentd({ cmd: 'wa-pair', id: agentId })
  },

  async unlink({ agentId }: { agentId: string }): Promise<void> {
    await agentd({ cmd: 'wa-unlink', id: agentId })
  },

  env(audience: Audience): string[] {
    const allowed = audience.open ? '*' : [audience.ownerAddress, ...audience.allowed].map(digits).join(',')
    return ['WHATSAPP_ENABLED=true', 'WHATSAPP_MODE=bot', 'WHATSAPP_DM_POLICY=allowlist', `WHATSAPP_ALLOWED_USERS=${allowed}`]
  },

  approver: (audience: Audience): string => `${digits(audience.ownerAddress)}@s.whatsapp.net`,
}

const digits = (phone: string): string => phone.replace(/\D/g, '')
