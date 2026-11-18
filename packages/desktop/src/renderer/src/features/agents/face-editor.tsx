import { useState } from 'react'
import { BanIcon, Cancel01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Creature } from '@/components/creature'
import { DialogTitle } from '@/components/ui/dialog'
import { I } from '@/components/kit'
import { EXTRAS, EYES, EYEWEAR, HAIRS, HAIR_COLORS, HATS, MOUTHS, NAMES, SWATCHES, bgColor, faceUri, randomLook, type Look } from '@/lib/face'
import { cn } from '@/lib/utils'

const PARTS = [['body', 'Colour'], ['eyes', 'Eyes'], ['mouth', 'Mouth'], ['hair', 'Hair'], ['hat', 'Hat'], ['eyewear', 'Eyewear'], ['extra', 'Extra'], ['bg', 'Background']] as const
type Part = (typeof PARTS)[number][0]
type Art = { kind: 'image'; uri: string } | { kind: 'disc'; color: string; square?: boolean } | { kind: 'none' }
type Option = { key: string; label: string; selected: boolean; patch: Partial<Look>; art: Art }

export const stageColor = (look: Look) => bgColor(look.bg) ?? 'var(--sidebar)'
export const tileClass = (on: boolean) => cn('grid place-items-center rounded-lg', on ? 'bg-card shadow-[inset_0_0_0_1.5px_var(--ink)]' : 'bg-sidebar hover:bg-picked')

const thumb = ({ look, view }: { look: Look; view: 'face' | 'head' | 'full' }) => ({ kind: 'image', uri: faceUri({ look, view, size: 36 }) }) as const
const none = (label: string, selected: boolean, patch: Partial<Look>): Option => ({ key: 'none', label, selected, patch, art: { kind: 'none' } })

function optionsFor({ part, draft }: { part: Part; draft: Look }): Option[] {
  const image = (key: string, label: string, selected: boolean, patch: Partial<Look>, view: 'face' | 'head' | 'full', also: Partial<Look> = {}): Option => ({ key, label, selected, patch, art: thumb({ look: { ...draft, ...patch, ...also }, view }) })
  if (part === 'body') return SWATCHES.map((swatch, body) => ({ key: swatch.id, label: swatch.name, selected: draft.body === body, patch: { body }, art: { kind: 'disc', color: swatch.fill } }))
  if (part === 'eyes') return EYES.map(({ name }, eyes) => image(name, name, draft.eyes === eyes, { eyes }, 'face', { eyewear: null }))
  if (part === 'mouth') return MOUTHS.map(({ name }, mouth) => image(name, name, draft.mouth === mouth, { mouth }, 'face', { eyewear: null }))
  if (part === 'hair') return [none('No hair', !draft.hair, { hair: null }), ...HAIRS.map((hair) => image(hair, NAMES[hair], draft.hair === hair, { hair }, 'head', { hat: null, extra: null }))]
  if (part === 'hat') return [none('No hat', !draft.hat, { hat: null }), ...HATS.map((hat) => image(hat, NAMES[hat], draft.hat === hat, { hat }, 'head', { extra: null }))]
  if (part === 'eyewear') return [none('No eyewear', !draft.eyewear, { eyewear: null }), ...EYEWEAR.map((eyewear) => image(eyewear, NAMES[eyewear], draft.eyewear === eyewear, { eyewear }, 'face'))]
  if (part === 'extra') return [none('No extra', !draft.extra, { extra: null }), ...EXTRAS.map((extra) => image(extra, NAMES[extra], draft.extra === extra, { extra }, 'full', { bg: null }))]
  const shades = [{ id: 'white', name: 'White' }, { id: 'grey', name: 'Grey' }, ...SWATCHES]
  return [none('No background', !draft.bg, { bg: null }), ...shades.map(({ id, name }) => ({ key: id, label: name, selected: draft.bg === id, patch: { bg: id }, art: { kind: 'disc', color: bgColor(id) ?? '', square: true } }) satisfies Option)]
}

function Swatch({ art }: { art: Art }) {
  if (art.kind === 'image') return <img src={art.uri} width={36} height={36} alt="" className="block" />
  if (art.kind === 'none') return <I icon={BanIcon} size={22} className="text-mute" />
  return <span className={cn('block size-[26px] shadow-[inset_0_0_0_1px_oklch(0%_0_0/.18)]', art.square ? 'rounded-md' : 'rounded-full')} style={{ background: art.color }} />
}

export function FaceEditor({ initial, onDone, onCancel }: { initial: Look; onDone: (look: Look) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(initial)
  const [part, setPart] = useState<Part>('body')
  const [spin, setSpin] = useState(0)
  const change = (patch: Partial<Look>) => setDraft({ ...draft, ...patch })
  const swap = (look: Look) => { setDraft(look); setSpin(spin + 1) }
  return <>
    <div className="flex items-start gap-3 px-5 pt-5 pb-3">
      <div className="grid flex-1 gap-0.5"><DialogTitle className="text-[15px]/[22px] font-medium">Customize face</DialogTitle><p className="m-0 text-[13px]/[18px] text-body">Hair, hats and extras only appear when you add them here.</p></div>
      <Button type="button" size="icon-sm" aria-label="Close" title="Close" className="rounded-full" onClick={onCancel}><I icon={Cancel01Icon} size={15} /></Button>
    </div>
    <div className="flex min-h-[340px] gap-5 px-5 pt-1 pb-4">
      <div className="flex w-44 shrink-0 flex-col items-center gap-2.5">
        <div className="grid size-44 place-items-center rounded-lg shadow-[inset_0_0_0_1px_var(--hair)]" style={{ background: stageColor(draft) }}>
          <span key={spin} className={cn('block', spin > 0 && 'animate-hop')}><Creature look={draft} size={148} label="Face preview" /></span>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => swap(randomLook({ seed: `face_${Math.floor(Math.random() * 1e6)}` }))}>Randomize</Button>
          <Button type="button" size="sm" onClick={() => swap(initial)}>Reset</Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3.5">
        <div role="group" aria-label="Part" className="flex flex-wrap gap-1.5">{PARTS.map(([key, label]) => <Button key={key} type="button" variant={part === key ? 'primary' : 'ghost'} size="sm" autoFocus={key === 'body'} aria-pressed={part === key} className="text-[13px]" onClick={() => setPart(key)}>{label}</Button>)}</div>
        <div role="group" aria-label="Options" className="grid grid-cols-7 gap-1.5">{optionsFor({ part, draft }).map((option) => <Button key={option.key} type="button" variant="bare" aria-pressed={option.selected} aria-label={option.label} title={option.label} className={cn('aspect-square', tileClass(option.selected))} onClick={() => change(option.patch)}><Swatch art={option.art} /></Button>)}</div>
        {part === 'hair' && draft.hair && <div className="flex flex-col gap-2">
          <span className="text-[12px]/[16px] text-mute">Hair colour</span>
          <div role="group" aria-label="Hair colour" className="grid grid-cols-7 gap-1.5">{HAIR_COLORS.map(({ id, name, color }, hairColor) => <Button key={id} type="button" variant="bare" aria-pressed={draft.hairColor === hairColor} aria-label={name} title={name} className={cn('aspect-square', tileClass(draft.hairColor === hairColor))} onClick={() => change({ hairColor })}><Swatch art={{ kind: 'disc', color }} /></Button>)}</div>
        </div>}
      </div>
    </div>
    <div className="flex items-center gap-2 border-t-[0.5px] border-hair px-5 py-3">
      <span className="flex-1 text-[12px]/[16px] text-mute">Randomize never adds hair or a second accessory.</span>
      <Button type="button" variant="secondary" className="rounded-full px-3.5" onClick={onCancel}>Cancel</Button>
      <Button type="button" variant="primary" className="rounded-full px-4" onClick={() => onDone(draft)}>Done</Button>
    </div>
  </>
}
