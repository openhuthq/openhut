import type { ReactNode } from 'react'
import { ArrowRight01Icon, Search01Icon, Tick02Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import { PROVIDERS, modelKey, type Provider, type ProviderModel } from '@openhut/common/models/provider.ts'
import { buttonVariants } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuEmpty, DropdownMenuFilter, DropdownMenuInput, DropdownMenuItem, DropdownMenuList, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Glyph } from '@/components/glyph'
import { I } from '@/components/kit'
import { find, glyphOf, labOf, prices } from '@/features/models/labels'
import { cn } from '@/lib/utils'

const SEARCH_FROM = 8
const LABEL = 'px-2 pt-1.5 pb-1 text-[12px] text-mute'

export const SOFT_TRIGGER = cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'min-w-[136px] max-w-full justify-between')

export type PickerNone = { name: string; note: string; icon: ReactNode }

export function ModelPicker({ providers, value, onPick, title, label, none, disabled, className, children }: {
  providers: Provider[] | undefined
  value: string | null
  onPick: (key: string | null) => void
  title: string
  label: string
  none?: PickerNone
  disabled?: boolean
  className?: string
  children?: ReactNode
}) {
  const connected = PROVIDERS.flatMap((info) => providers?.find((each) => each.id === info.id && each.connected) ?? [])
  const missing = PROVIDERS.filter((info) => !connected.some((provider) => provider.id === info.id))
  return <DropdownMenu>
    <DropdownMenuTrigger className={className ?? SOFT_TRIGGER} disabled={disabled} aria-label={`${label}: ${find({ providers, key: value }).model?.name ?? value ?? none?.name ?? 'None'}`}>
      {children ?? <ModelValue providers={providers} value={value} none={none} />}
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-[260px]">
      <div className={LABEL}>{title}</div>
      {none && <>
        <Choice icon={none.icon} name={none.name} note={none.note} selected={value === null} onClick={() => onPick(null)} />
        <DropdownMenuSeparator />
      </>}
      {connected.map((provider) => <ProviderMenu key={provider.id} provider={provider} value={value} onPick={onPick} />)}
      {missing.length > 0 && <>
        <div className={LABEL}>Not set up</div>
        {missing.map((info) => <Choice key={info.id} icon={<Glyph name={info.id} size={14} />} name={info.short} note={info.kind === 'subscription' ? 'Sign in under Settings › Models' : 'Add a key under Settings › Models'} disabled />)}
      </>}
    </DropdownMenuContent>
  </DropdownMenu>
}

function ProviderMenu({ provider, value, onPick }: { provider: Provider; value: string | null; onPick: (key: string) => void }) {
  const models = provider.models.filter((model) => model.on)
  const labs = [...new Set(models.map(labOf))].map((lab) => models.filter((model) => labOf(model) === lab))
  const keyOf = (model: string) => modelKey({ provider: provider.id, model })
  const picked = models.find((model) => keyOf(model.id) === value)
  const priced = models.some((model) => prices(model))
  return <DropdownMenuFilter>
    <DropdownMenuSub>
      <DropdownMenuSubTrigger size="tall">
        <Tile><Glyph name={provider.id} size={15} /></Tile>
        <Text name={provider.name} note={picked?.name ?? `${models.length} ${models.length === 1 ? 'model' : 'models'} on`} />
        {picked && <I icon={Tick02Icon} size={14} className="text-ink" />}
        <I icon={ArrowRight01Icon} size={14} />
      </DropdownMenuSubTrigger>
      <DropdownMenuContent side="right" align="start" sideOffset={6} className="flex max-h-(--available-height) w-[330px] flex-col overflow-hidden">
        {models.length > SEARCH_FROM && <div className="relative mx-0.5 mt-0.5 mb-1 shrink-0">
          <I icon={Search01Icon} size={14} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-mute" />
          <DropdownMenuInput placeholder={`Search ${provider.name} models`} aria-label="Search models" className="h-[30px] w-full rounded-lg border-0 bg-soft pr-2.5 pl-7 text-[13px] outline-none" />
        </div>}
        <DropdownMenuList className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {labs.map((group, index) => <div key={labOf(group[0])} className={cn(index > 0 && 'mt-1 border-t border-hair pt-1')}>
            {group.map((model) => <ModelRow key={model.id} provider={provider} model={model} selected={keyOf(model.id) === value} onClick={() => onPick(keyOf(model.id))} />)}
          </div>)}
        </DropdownMenuList>
        <DropdownMenuEmpty className="px-2 py-3 text-[13px] text-mute">No model matches.</DropdownMenuEmpty>
        {priced && <div className="mt-1 shrink-0 border-t border-hair px-2 pt-1.5 pb-1 text-[11.5px] text-mute">Prices are $ per million tokens, in / out</div>}
      </DropdownMenuContent>
    </DropdownMenuSub>
  </DropdownMenuFilter>
}

function ModelRow({ provider, model, selected, onClick }: { provider: Provider; model: ProviderModel; selected: boolean; onClick: () => void }) {
  const side = provider.kind === 'key' ? prices(model) : model.note
  return <DropdownMenuItem label={`${model.name} ${model.id}`} title={model.id} onClick={onClick}>
    <Glyph name={glyphOf({ provider, model })} size={16} />
    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{model.name}</span>
    {side && <span className="shrink-0 text-[12px] text-mute tabular-nums">{side}</span>}
    <span className="grid w-3.5 shrink-0 place-items-center">{selected && <I icon={Tick02Icon} size={14} className="text-ink" />}</span>
  </DropdownMenuItem>
}

export function ModelValue({ providers, value, none, known }: { providers: Provider[] | undefined; value: string | null; none?: PickerNone; known?: string | null }) {
  const { split, model } = find({ providers, key: value })
  if (!split) return <>
    <span className="grid w-3.5 shrink-0 place-items-center">{none?.icon}</span>
    <span className="min-w-0 flex-1 truncate text-left font-normal text-mute">{none?.name ?? 'Choose a model'}</span>
    <I icon={UnfoldMoreIcon} size={12} className="text-mute" />
  </>
  return <>
    <span className="grid w-3.5 shrink-0 place-items-center"><Glyph name={split.provider} size={14} /></span>
    <span className="min-w-0 flex-1 truncate text-left">{model?.name ?? known ?? split.model}</span>
    <I icon={UnfoldMoreIcon} size={12} className="text-mute" />
  </>
}

function Choice({ icon, name, note, selected = false, disabled = false, onClick }: { icon?: ReactNode; name: string; note: string; selected?: boolean; disabled?: boolean; onClick?: () => void }) {
  return <DropdownMenuItem size="tall" disabled={disabled} onClick={onClick}>
    {icon && <Tile>{icon}</Tile>}
    <Text name={name} note={note} />
    {selected && <I icon={Tick02Icon} size={14} className="text-ink" />}
  </DropdownMenuItem>
}

function Tile({ children }: { children: ReactNode }) {
  return <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-soft text-ink">{children}</span>
}

function Text({ name, note }: { name: string; note: string }) {
  return <span className="grid min-w-0 flex-1 leading-tight"><span className="text-[13px] font-medium text-ink">{name}</span>{note && <span className="truncate text-[11.5px] text-mute" title={note}>{note}</span>}</span>
}
