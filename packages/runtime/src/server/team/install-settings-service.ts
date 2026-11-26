import { connect } from 'node:tls'
import { checkAddress, saveAddress } from '../platform/address.ts'
import type { InstallSettings, UpdateInstallSettings } from '@openhut/common/team/team.ts'
import { config } from '../platform/config.ts'
import { publicAddress } from '../platform/address.ts'
import { db } from '../platform/db.ts'
import { emit, log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { settings } from '../platform/settings.ts'
import { smtp } from '../integrations/smtp/smtp.ts'
import { connectionService } from '../connections/connection-service.ts'
import { requireAdmin, type Caller } from './identity.ts'
import { googleRedirectUri } from './team-service.ts'

const USAGE_MS = 86_400_000

export const installSettingsService = {
  async get({ actor }: { actor: Caller }): Promise<InstallSettings> {
    requireAdmin(actor)
    const google = settings.googleClient()
    const mail = settings.smtp()
    return {
      object: 'install_settings',
      address: { url: settings.address() ?? null, certificateUntil: config.behindProxy ? null : await certificateUntil(), proxy: config.behindProxy },
      google: { set: !!google, signIn: settings.googleSignIn(), clientId: google?.id ?? null, signInRedirectUri: googleRedirectUri(), connectionsRedirectUri: connectionService.redirectUrl() },
      smtp: { set: !!mail, host: mail?.host ?? null, port: mail?.port ?? null, user: mail?.user || null, from: mail?.from ?? null },
      usageData: settings.usageData(),
      githubFooter: settings.githubFooter(),
    }
  },

  async update({ actor, patch }: { actor: Caller; patch: UpdateInstallSettings }): Promise<InstallSettings> {
    requireAdmin(actor)
    if (patch.address !== undefined) await saveAddress(checkAddress(patch.address))
    if (patch.googleClientId !== undefined || patch.googleClientSecret !== undefined) {
      const current = settings.googleClient()
      const id = patch.googleClientId ?? current?.id
      const secret = patch.googleClientSecret ?? current?.secret
      if (!id || !secret) throw new HttpError(400, 'Paste both the client ID and the client secret.', { param: id ? 'googleClientSecret' : 'googleClientId' })
      await settings.setGoogleClient({ id, secret })
    }
    if (patch.googleSignIn !== undefined) {
      if (patch.googleSignIn && !settings.googleClient()) throw new HttpError(409, 'Add your Google OAuth client first.', { param: 'googleClientId' })
      await settings.setGoogleSignIn(patch.googleSignIn)
    }
    if (patch.smtpHost !== undefined || patch.smtpFrom !== undefined) {
      const current = settings.smtp()
      const host = patch.smtpHost ?? current?.host
      const from = patch.smtpFrom ?? current?.from
      if (!host || !from) throw new HttpError(400, 'Enter the SMTP host and the from address.', { param: host ? 'smtpFrom' : 'smtpHost' })
      await settings.setSmtp({ host, from, port: patch.smtpPort ?? current?.port ?? 587, user: patch.smtpUser ?? current?.user ?? '', password: patch.smtpPassword || current?.password || '' })
    }
    if (patch.usageData !== undefined) await settings.setUsageData(patch.usageData)
    if (patch.githubFooter !== undefined) await settings.setGithubFooter(patch.githubFooter)
    emit({ name: 'security.updated', actor, target: { type: 'settings', id: 'security', fields: Object.keys(patch) } })
    return installSettingsService.get({ actor })
  },

  async sendTestEmail({ actor }: { actor: Caller }): Promise<{ object: 'test_email'; to: string }> {
    requireAdmin(actor)
    const server = settings.smtp()
    if (!server) throw new HttpError(409, 'Set up email first.')
    await smtp.send({ server, to: actor.email, subject: 'OpenHut test email', text: `Email from ${publicAddress()} works. Invites and password resets can go out now.` })
    return { object: 'test_email', to: actor.email }
  },

  startUsageData(): void {
    setInterval(() => void sendUsage().catch((err: unknown) => log.warn({ event: 'usage.failed', error: messageOf(err) })), USAGE_MS).unref()
  },
}

function certificateUntil(): Promise<string | null> {
  const address = settings.address()
  if (!address) return Promise.resolve(null)
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: 443, servername: new URL(address).hostname, timeout: 3000 }, () => {
      const until = socket.getPeerCertificate().valid_to
      socket.destroy()
      resolve(until && socket.authorized ? new Date(until).toISOString() : null)
    })
    socket.on('error', () => resolve(null)).on('timeout', () => { socket.destroy(); resolve(null) })
  })
}

async function sendUsage(): Promise<void> {
  if (!settings.usageData()) return
  const { agents } = await db.selectFrom('agent').select((eb) => eb.fn.countAll<number>().as('agents')).executeTakeFirstOrThrow()
  const events = [{ name: 'instance_active', properties: { agents: Number(agents) }, at: Date.now() }]
  await fetch(`${config.releaseUrl}/api/events`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ instance: await settings.installId(), version: config.version, kind: 'server', events }),
  })
}
