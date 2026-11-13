import { ADDRESS, type Channel, type ChannelKind } from '@fastmonkey/common/channels/channel.ts'
import { Field } from '@/components/field'
import { fieldError } from '@/lib/api-client'

const WORDING: Record<ChannelKind, { only: string; anyone: string; list: string; placeholder: string; hint: string }> = {
  slack: { only: 'Only people I list', anyone: 'Anyone in the workspace', list: 'Slack member IDs', placeholder: 'U012AB3CD, U045EF6GH', hint: 'Besides you. Separate them with commas.' },
  whatsapp: { only: 'Only numbers I list', anyone: 'Anyone who messages the number', list: 'Phone numbers', placeholder: '+15551234567, +447700900123', hint: 'Besides yours, with country code. Separate them with commas.' },
}

export function AudienceFields({ kind, channel, error }: { kind: ChannelKind; channel: Channel | undefined; error: Error | null }) {
  const wording = WORDING[kind]
  const address = addressPattern(kind)
  return <>
    <Field label="Who can message" error={fieldError(error, 'open')}>{(control) =>
      <select {...control} name="open" defaultValue={channel?.open ? '1' : ''}><option value="">{wording.only}</option><option value="1">{wording.anyone}</option></select>}</Field>
    <Field className="f allowed" label={wording.list} error={fieldError(error, 'allowed')} hint={wording.hint}>{(control) =>
      <input {...control} name="allowed" className="mono" defaultValue={channel?.allowed.join(', ')} placeholder={wording.placeholder} autoComplete="off"
        pattern={`[\\s,]*${address}(?:[\\s,]+${address})*[\\s,]*`} title={ADDRESS[kind].message} />}</Field>
  </>
}

export function audienceOf(field: (name: string) => string) {
  return { open: field('open') === '1', allowed: field('allowed').split(/[\s,]+/).filter(Boolean) }
}

export function addressPattern(kind: ChannelKind) {
  return ADDRESS[kind].pattern.source.slice(1, -1)
}
