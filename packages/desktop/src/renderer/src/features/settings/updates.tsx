import { CloudDownloadIcon } from '@hugeicons/core-free-icons'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { I, Section } from '@/components/kit'
import { usePrefs, useSetPrefs } from '@/features/settings/desktop'
import { Row, Rows } from '@/features/settings/kit'
import { updateNote, useAppUpdate } from '@/features/settings/update'
import { CheckButton, UpdateEverything, UpdateStatus } from '@/features/settings/update-pill'
import { toastError } from '@/lib/toast'

const CHANNELS = [
  { value: 'stable', title: 'Stable releases', note: 'Tested and ready.' },
  { value: 'beta', title: 'Try new features first', note: 'Get beta versions early.' },
]

export function UpdatesSettings() {
  const state = useAppUpdate().data
  return <>
    {state && <Rows>
      <Row icon={<I icon={CloudDownloadIcon} size={20} className="text-hue-sky" />} title={`OpenHut ${state.current}`} note={updateNote(state)}><UpdateStatus idle={<CheckButton label="Check for updates" />} /></Row>
    </Rows>}
    <UpdateEverything />
    <Section title="Channel">
      <Channel prerelease={!!state?.current.includes('-')} />
    </Section>
  </>
}

function Channel({ prerelease }: { prerelease: boolean }) {
  const prefs = usePrefs()
  const setPrefs = useSetPrefs()
  if (!prefs.data) return null
  const picked = prefs.data.betaUpdates ? 'beta' : 'stable'
  return <>
    <RadioGroup name="channel" variant="card" aria-label="Update channel" className="px-2.5" onChange={(event) => setPrefs.mutate({ betaUpdates: (event.target as HTMLInputElement).value === 'beta' }, { onError: toastError })}>
      {CHANNELS.map((channel) => <RadioGroupItem key={channel.value} value={channel.value} defaultChecked={channel.value === picked} disabled={setPrefs.isPending}>
        <span className="font-medium">{channel.title}</span>
        <span className="col-start-2 text-[12px]/[16px] text-mute">{channel.note}</span>
      </RadioGroupItem>)}
    </RadioGroup>
    {prerelease && picked === 'stable' && <p className="m-0 px-2.5 text-[12px]/[16px] text-mute">You stay on this version until a newer stable one.</p>}
  </>
}
