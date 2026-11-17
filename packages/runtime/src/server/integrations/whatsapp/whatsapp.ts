import type { Audience } from '@openhut/common/channels/channel.ts'

export const whatsapp = {
  env(audience: Audience): string[] {
    const allowed = audience.open ? '*' : [audience.ownerAddress, ...audience.allowed].map((phone) => phone.replace(/\D/g, '')).join(',')
    return ['WHATSAPP_ENABLED=true', 'WHATSAPP_MODE=bot', 'WHATSAPP_DM_POLICY=allowlist', `WHATSAPP_ALLOWED_USERS=${allowed}`]
  },

  yaml: 'whatsapp:\n  gateway_restart_notification: false\n',
}
