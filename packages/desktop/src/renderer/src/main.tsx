import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '@/app/app'
import { desktop } from '@/features/settings/desktop'
import { RequestError } from '@/lib/api-client'
import { followEnrollments } from '@/features/computers/enroll'
import { openhut } from '@/lib/openhut'
import { AGENTS_KEY, COMPUTERS_KEY, CONNECTIONS_KEY } from '@/lib/query-keys'
import sprite from '@/logos.svg?raw'
import '@fontsource-variable/inter/wght.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/bebas-neue/400.css'
import '@/index.css'

const client = new QueryClient({
  defaultOptions: { queries: { retry: (failures, error) => failures < 2 && !(error instanceof RequestError && error.status < 500) } },
})

if ('openhut' in window && navigator.userAgent.includes('Mac')) document.documentElement.dataset.desktop = ''
desktop?.onChanged(() => void client.invalidateQueries())
followEnrollments(client)
addEventListener('pointerdown', () => { document.documentElement.dataset.pointer = '' }, true)
addEventListener('keydown', () => { delete document.documentElement.dataset.pointer }, true)
openhut.subscribe(() => { for (const queryKey of [AGENTS_KEY, CONNECTIONS_KEY, COMPUTERS_KEY]) void client.invalidateQueries({ queryKey }) })
document.body.insertAdjacentHTML('afterbegin', sprite)
const root = document.getElementById('root')
if (root) createRoot(root).render(<QueryClientProvider client={client}><App /></QueryClientProvider>)
