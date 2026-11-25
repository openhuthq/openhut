import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { ProviderParams, UpdateProvider } from '@openhut/common/models/provider.ts'
import { listOf } from '../platform/responses.ts'
import { admin, who } from '../team/identity.ts'
import { providerService } from './provider-service.ts'

export const providerController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', async (req) => {
    await who(req)
    return listOf({ req, data: providerService.list() })
  })

  app.get('/:id', ParamsRequest, async (req) => {
    await who(req)
    return providerService.get(req.params)
  })

  app.patch('/:id', UpdateRequest, async (req) => providerService.update({ actor: await admin(req), id: req.params.id, patch: req.body }))

  app.post('/:id/refresh', ParamsRequest, async (req) => {
    await admin(req)
    return providerService.refresh(req.params)
  })

  app.delete('/:id', ParamsRequest, async (req) => providerService.disconnect({ actor: await admin(req), ...req.params }))
}

const ParamsRequest = { schema: { params: ProviderParams } }
const UpdateRequest = { schema: { params: ProviderParams, body: UpdateProvider } }
