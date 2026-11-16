import { ADDRESS, type Channel, type ChannelKind } from '@openhut/common/channels/channel.ts'
import { Field, FieldError, FieldSet, FieldTitle } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Choices } from '@/components/setup'
import { fieldError } from '@/lib/api-client'

type PeopleKind = Exclude<ChannelKind, 'slack'>

const WORDING: Record<PeopleKind, { only: string; anyone: string; list: string; placeholder: string; hint: string }> = {
  whatsapp: { only: 'Numbers I list', anyone: 'Anyone', list: 'Phone numbers', placeholder: '+15551234567, +447700900123', hint: 'Besides yours, with country code. Separate them with commas.' },
  telegram: { only: 'People I list', anyone: 'Anyone', list: 'Telegram user IDs', placeholder: '123456789, 987654321', hint: 'Besides you. Separate them with commas.' },
}

export function AudienceFields({ kind, channel, error, labelled = true }: { kind: PeopleKind; channel: Channel | undefined; error: Error | null; labelled?: boolean }) {
  const wording = WORDING[kind]
  const address = addressPattern(kind)
  return <>
    <FieldSet className="peer/open">{labelled && <FieldTitle>Who can message</FieldTitle>}
      <Choices name="open" value={channel?.open ? '1' : ''} options={[['', 'users', wording.only], ['1', 'globe', wording.anyone]]} />
      {fieldError(error, 'open') && <FieldError>{fieldError(error, 'open')}</FieldError>}
    </FieldSet>
    <Field className="hidden peer-has-[input[name=open][value='']:checked]/open:flex" label={wording.list} error={fieldError(error, 'allowed')} hint={wording.hint}>{(control) =>
      <Input {...control} mono name="allowed" defaultValue={channel?.allowed.join(', ')} placeholder={wording.placeholder} autoComplete="off"
        pattern={`[\\s,]*${address}(?:[\\s,]+${address})*[\\s,]*`} title={ADDRESS[kind].message} />}</Field>
  </>
}

export function audienceOf(field: (name: string) => string) {
  return { open: field('open') === '1', allowed: field('allowed').split(/[\s,]+/).filter(Boolean) }
}

export function addressPattern(kind: ChannelKind) {
  return ADDRESS[kind].pattern.source.slice(1, -1)
}
