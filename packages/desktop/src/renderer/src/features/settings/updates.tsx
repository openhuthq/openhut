import { CloudDownloadIcon, TestTube01Icon } from '@hugeicons/core-free-icons'
import { buttonVariants } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { I, PILL } from '@/components/kit'
import { desktop, usePrefs } from '@/features/settings/desktop'
import { PrefSwitch } from '@/features/settings/general'
import { Row, Rows } from '@/features/settings/kit'
import { downloadUrl, updateNote, useAppUpdate, type UpdateState } from '@/features/settings/update'
import { CheckButton, UpdatePill } from '@/features/settings/update-pill'
import { cn } from '@/lib/utils'

export function UpdatesSettings() {
  const state = useAppUpdate().data
  const prefs = usePrefs()
  if (!desktop) return <Rows><Row icon={<I icon={CloudDownloadIcon} size={20} className="text-hue-sky" />} title="OpenHut" note="Updates install from the OpenHut app on this computer." /></Rows>
  if (!state) return null
  const stays = state.current.includes('-') && prefs.data?.betaUpdates === false
  return <Rows>
    <Row icon={<I icon={CloudDownloadIcon} size={20} className="text-hue-sky" />} title={`OpenHut ${state.current}`} note={updateNote(state)}><Action state={state} /></Row>
    <PrefSwitch icon={TestTube01Icon} hue="text-hue-violet" name="betaUpdates" title="Try new features early" note={stays ? 'You stay on this beta until the next regular version is out.' : 'Get beta versions before everyone else.'} />
  </Rows>
}

function Action({ state }: { state: UpdateState }) {
  if (state.ready) return <UpdatePill />
  if (state.checking || state.available) return <Spinner className="mt-0" />
  if (!state.error) return <CheckButton label="Check for updates" />
  return <>
    <a href={downloadUrl(Reflect.get(window, 'openhut')?.platform)} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'ghost' }), PILL, 'text-mute')}>Download</a>
    <CheckButton label="Try again" />
  </>
}
