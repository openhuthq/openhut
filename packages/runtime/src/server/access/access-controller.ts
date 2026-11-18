import type { FastifyPluginAsync } from 'fastify'
import { Access } from '@openhut/common/access/access.ts'
import { who } from '../team/identity.ts'
import { accessService } from './access-service.ts'

export const accessController: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => {
    await who(req)
    return accessService.get()
  })

  app.put<{ Body: Access }>('/', PutRequest, async (req) => accessService.put({ caller: await who(req), access: req.body }))
}

const PutRequest = { schema: { body: Access } }
