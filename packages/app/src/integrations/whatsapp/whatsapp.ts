import type { Audience } from '@fastmonkey/common/channels/channel.ts'

export const whatsapp = {
  env(audience: Audience): string[] {
    const allowed = audience.open ? '*' : [audience.ownerAddress, ...audience.allowed].map((phone) => phone.replace(/\D/g, '')).join(',')
    return ['WHATSAPP_ENABLED=true', 'WHATSAPP_MODE=bot', 'WHATSAPP_DM_POLICY=allowlist', `WHATSAPP_ALLOWED_USERS=${allowed}`]
  },

  approver: (audience: Audience): string => `${audience.ownerAddress.replace(/\D/g, '')}@s.whatsapp.net`,
}
