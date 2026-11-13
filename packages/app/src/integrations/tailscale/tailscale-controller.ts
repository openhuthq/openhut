import type { FastifyPluginAsync } from 'fastify'
import { ConnectTailscale } from '@fastmonkey/common/connections/connection.ts'
import { requireSignIn, who } from '../../team/identity.ts'
import { tailscaleService } from './tailscale-service.ts'

export const tailscaleController: FastifyPluginAsync = async (app) => {
  app.get('/', SignedIn, async () => tailscaleService.get())

  app.put<{ Body: ConnectTailscale }>('/', ConnectRequest, async (req) => tailscaleService.connect({ actor: await who(req), authKey: req.body.authKey }))

  app.delete('/', async (req) => tailscaleService.disconnect({ actor: await who(req) }))
}

const SignedIn = { onRequest: requireSignIn }
const ConnectRequest = { schema: { body: ConnectTailscale } }
