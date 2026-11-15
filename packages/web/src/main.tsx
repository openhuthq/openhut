import { createRoot } from 'react-dom/client'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '@/app/app'
import { RequestError } from '@/lib/api-client'
import { ME_KEY } from '@/lib/query-keys'
import sprite from '@/logos.svg?raw'
import '@/index.css'

const client = new QueryClient({
  queryCache: new QueryCache({ onError: forgetSession }),
  mutationCache: new MutationCache({ onError: forgetSession }),
  defaultOptions: { queries: { retry: (failures, error) => failures < 2 && !(error instanceof RequestError && error.status < 500) } },
})

document.body.insertAdjacentHTML('afterbegin', sprite)
const root = document.getElementById('root')
if (root) createRoot(root).render(<QueryClientProvider client={client}><App /></QueryClientProvider>)

function forgetSession(error: Error) {
  if (error instanceof RequestError && error.status === 401) client.setQueryData(ME_KEY, null)
}
