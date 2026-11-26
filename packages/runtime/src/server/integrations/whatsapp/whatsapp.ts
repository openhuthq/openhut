import type { Audience } from '@openhut/common/channels/channel.ts'

export const whatsapp = {
  env(audience: Audience): Record<string, string> {
    const allowed = audience.open ? '*' : [audience.ownerAddress, ...audience.allowed].map((phone) => phone.replace(/\D/g, '')).join(',')
    return { WHATSAPP_ENABLED: 'true', WHATSAPP_MODE: 'bot', WHATSAPP_DM_POLICY: 'allowlist', WHATSAPP_ALLOWED_USERS: allowed }
  },

  config({ bridgePort }: { bridgePort?: number }): Record<string, unknown> {
    return { whatsapp: { gateway_restart_notification: false, ...bridgePort && { bridge_port: bridgePort } } }
  },
}
