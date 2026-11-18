import type { FastifyPluginAsync } from 'fastify'
import { ProviderParams, UpdateProvider } from '@openhut/common/models/provider.ts'
import { listOf } from '../platform/responses.ts'
import { who } from '../team/identity.ts'
import { providerService } from './provider-service.ts'

export const providerController: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => {
    await who(req)
    return listOf({ req, data: providerService.list() })
  })

  app.get<{ Params: ProviderParams }>('/:id', ParamsRequest, async (req) => {
    await who(req)
    return providerService.get(req.params)
  })

  app.patch<{ Params: ProviderParams; Body: UpdateProvider }>('/:id', UpdateRequest, async (req) => providerService.update({ actor: await who(req), id: req.params.id, patch: req.body }))

  app.post<{ Params: ProviderParams }>('/:id/refresh', ParamsRequest, async (req) => {
    await who(req)
    return providerService.refresh(req.params)
  })

  app.delete<{ Params: ProviderParams }>('/:id', ParamsRequest, async (req) => providerService.disconnect({ actor: await who(req), ...req.params }))
}

const ParamsRequest = { schema: { params: ProviderParams } }
const UpdateRequest = { schema: { params: ProviderParams, body: UpdateProvider } }
