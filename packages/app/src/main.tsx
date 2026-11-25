import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '@/app/app'
import { DEV_LABEL, DevPill } from '@/components/dev-pill'
import { Toaster } from '@/components/ui/sonner'
import hutDev from '@/hut-dev.svg'
import { openhut } from '@/lib/openhut'
import { RequestError } from '@/lib/api-client'
import { followEvents } from '@/lib/live'
import sprite from '@/logos.svg?raw'
import '@fontsource-variable/inter/wght.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/bebas-neue/400.css'
import '@/index.css'
import { REMOTE } from '@/lib/remote'
import { RemoteGate } from '@/app/remote-gate'

const client = new QueryClient({
  defaultOptions: { queries: { retry: (failures, error) => failures < 2 && !(error instanceof RequestError && error.status < 500) } },
})

addEventListener('pointerdown', () => { document.documentElement.dataset.pointer = '' }, true)
addEventListener('keydown', (event) => { if (event.key === 'Tab') delete document.documentElement.dataset.pointer }, true)
if (!REMOTE) followEvents(client)
document.body.insertAdjacentHTML('afterbegin', sprite)
if (DEV_LABEL) {
  Reflect.set(globalThis, 'openhutFetch', (path: string, init?: RequestInit) => openhut.fetch({ path, init }))
  document.title = 'OpenHut Dev'
  document.querySelector<HTMLLinkElement>('link[rel=icon]')?.setAttribute('href', hutDev)
}
const root = document.getElementById('root')
if (root) createRoot(root).render(<QueryClientProvider client={client}>{REMOTE ? <RemoteGate><App /></RemoteGate> : <App />}<DevPill /><Toaster /></QueryClientProvider>)
