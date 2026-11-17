import { ADDRESS, type Channel, type ChannelKind } from '@openhut/common/channels/channel.ts'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { fieldError } from '@/lib/api-client'

type PeopleKind = Exclude<ChannelKind, 'slack'>

const WORDING: Record<PeopleKind, { label: string; placeholder: string; hint: string }> = {
  whatsapp: { label: 'Phone numbers', placeholder: '+15551234567, +447700900123', hint: 'With country code. The first one is yours.' },
  telegram: { label: 'Telegram user IDs', placeholder: '123456789, 987654321', hint: 'Message @userinfobot to get an ID.' },
}

export function PeopleField({ kind, channel, error }: { kind: PeopleKind; channel: Channel | undefined; error: Error | null }) {
  const wording = WORDING[kind]
  const address = addressPattern(kind)
  const known = channel ? [...new Set([channel.ownerAddress, ...channel.allowed])].join(', ') : undefined
  return <Field label={<span className="text-xs font-medium text-mute">{wording.label}</span>} error={fieldError(error, 'ownerAddress') ?? fieldError(error, 'allowed')} hint={wording.hint}>{(control) =>
    <Input {...control} mono name="people" required defaultValue={known} placeholder={wording.placeholder} autoComplete="off"
      pattern={`[\\s,]*${address}(?:[\\s,]+${address})*[\\s,]*`} title={ADDRESS[kind].message} />}</Field>
}

export function peopleOf(field: (name: string) => string) {
  const people = listOf(field)
  return { ownerAddress: people[0] ?? '', allowed: people.slice(1), open: false }
}

export function changeOf({ field, channel }: { field: (name: string) => string; channel: Channel }) {
  return { open: false, allowed: listOf(field).filter((each) => each !== channel.ownerAddress) }
}

function listOf(field: (name: string) => string) {
  return [...new Set(field('people').split(/[\s,]+/).filter(Boolean))]
}

export function addressPattern(kind: ChannelKind) {
  return ADDRESS[kind].pattern.source.slice(1, -1)
}
