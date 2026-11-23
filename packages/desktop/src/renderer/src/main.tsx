import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '@/app/app'
import { DEV_LABEL, DevPill } from '@/components/dev-pill'
import hutDev from '@/hut-dev.svg'
import { desktop } from '@/features/settings/desktop'
import { RequestError } from '@/lib/api-client'
import { followEnrollments } from '@/features/computers/enroll'
import { followUpdate, updates } from '@/features/settings/update'
import { followEvents } from '@/lib/live'
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
followUpdate({ bridge: updates, client })
addEventListener('pointerdown', () => { document.documentElement.dataset.pointer = '' }, true)
addEventListener('keydown', (event) => { if (event.key === 'Tab') delete document.documentElement.dataset.pointer }, true)
followEvents(client)
document.body.insertAdjacentHTML('afterbegin', sprite)
if (DEV_LABEL) {
  document.title = 'OpenHut Dev'
  document.querySelector<HTMLLinkElement>('link[rel=icon]')?.setAttribute('href', hutDev)
}
const root = document.getElementById('root')
if (root) createRoot(root).render(<QueryClientProvider client={client}><App /><DevPill /></QueryClientProvider>)
