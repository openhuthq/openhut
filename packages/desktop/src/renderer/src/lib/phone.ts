import { isPhone, onLink } from '@/lib/native'
import { navigate } from '@/lib/router'

if (isPhone()) onLink((url) => { if (url.startsWith('openhut://join#')) navigate(`/join${url.slice(url.indexOf('#'))}`) })
