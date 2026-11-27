import { createRoot } from 'react-dom/client'
import { App } from '@/app/app'
import { AppProvider, queryClient } from '@/app/provider'
import { DEV_LABEL } from '@/components/dev-pill'
import hutDev from '@/hut-dev.svg'
import { openhut } from '@/lib/openhut'
import { followEvents } from '@/lib/live'
import sprite from '@/logos.svg?raw'
import '@fontsource-variable/inter/wght.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/bebas-neue/400.css'
import '@/index.css'

addEventListener('pointerdown', () => { document.documentElement.dataset.pointer = '' }, true)
addEventListener('keydown', (event) => { if (event.key === 'Tab') delete document.documentElement.dataset.pointer }, true)
followEvents(queryClient)
document.body.insertAdjacentHTML('afterbegin', sprite)
if (DEV_LABEL) {
  Reflect.set(globalThis, 'openhutFetch', (path: string, init?: RequestInit) => openhut.fetch({ path, init }))
  document.title = 'OpenHut Dev'
  document.querySelector<HTMLLinkElement>('link[rel=icon]')?.setAttribute('href', hutDev)
}
const root = document.getElementById('root')
if (root) createRoot(root).render(<AppProvider><App /></AppProvider>)
