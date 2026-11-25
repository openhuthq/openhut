import { createTransport } from 'nodemailer'
import { HttpError, messageOf } from '../../platform/http-error.ts'
import { log } from '../../platform/events.ts'
import type { Smtp } from '../../platform/settings.ts'

const TIMEOUT_MS = 20_000

export const smtp = {
  async send({ server, to, subject, text }: { server: Smtp; to: string; subject: string; text: string }): Promise<void> {
    const transport = createTransport({
      host: server.host, port: server.port, secure: server.port === 465, requireTLS: server.port !== 465 && server.port !== 25,
      auth: server.user ? { user: server.user, pass: server.password } : undefined,
      connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS,
    })
    await transport.sendMail({ from: `OpenHut <${server.from}>`, to, subject, text, disableFileAccess: true, disableUrlAccess: true }).catch((err: unknown) => {
      log.warn({ event: 'smtp.failed', host: server.host, error: messageOf(err) })
      throw new HttpError(502, `${server.host} didn't take the email: ${messageOf(err).slice(0, 200)}. Check the SMTP settings.`)
    })
  },
}
