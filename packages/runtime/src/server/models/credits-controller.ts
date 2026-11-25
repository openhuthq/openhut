import type { FastifyPluginAsync } from 'fastify'
import { HttpError } from '../platform/http-error.ts'
import { who } from '../team/identity.ts'
import { credits } from './providers/openhut.ts'

export const creditsController: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => {
    await who(req)
    const shown = await credits()
    if (!shown) throw new HttpError(404, 'Credits are only on a Cloud computer.')
    return shown
  })
}
