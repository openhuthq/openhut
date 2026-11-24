// The approval sheet (PickPair) alone, fed the Cloud's join request for the fixed GeoIP answers in private/api/test/trust/join-request.test.ts.
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/wght.css'
import '@/index.css'
import { PickPair } from '@/features/cloud/knock'

const away = location.search !== '?home'
const request = { device: 'phone', email: 'eve@example.com', at: new Date(Date.now() - 60_000).toISOString(), name: 'Phone', os: 'iOS', server: false, checked: true, reviewed: false, faces: [3, 8],
  location: away ? { city: 'Lyon', country: 'France', countryCode: 'FR' } : { city: 'London', country: 'United Kingdom', countryCode: 'GB' }, newCountry: away }
createRoot(document.getElementById('root')!).render(<PickPair label="Phone" request={request} busy={false} onPick={() => {}} onNotMe={() => {}} onClose={() => {}} />)
