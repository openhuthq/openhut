import type { ReactNode } from 'react'
import { ArrowRight01Icon, Search01Icon, Tick02Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import { PROVIDERS, modelKey, providerInfo, type Provider, type ProviderId, type ProviderModel } from '@openhut/common/models/provider.ts'
import { DropdownMenu, DropdownMenuContent, DropdownMenuEmpty, DropdownMenuFilter, DropdownMenuInput, DropdownMenuItem, DropdownMenuList, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Glyph } from '@/components/glyph'
import { FIELD_MENU, I, SOFT_TRIGGER } from '@/components/kit'
import { find, glyphOf, labOf, prices } from '@/lib/models'
import { cn } from '@/lib/utils'

const SEARCH_FROM = 8
const LABEL = 'px-2 pt-1.5 pb-1 text-[12px] text-mute'

export type PickerNone = { name: string; note: string; icon: ReactNode }

export function ModelPicker({ providers, value, onPick, onSetUp, title, label, none, disabled, className, children }: {
  providers: Provider[] | undefined
  value: string | null
  onPick: (key: string | null) => void
  onSetUp?: (id: ProviderId) => void
  title?: string
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
    <DropdownMenuContent align="end" className={FIELD_MENU}>
      {title && <div className={LABEL}>{title}</div>}
      {none && <Choice icon={none.icon} name={none.name} selected={value === null} onClick={() => onPick(null)} />}
      {connected.map((provider) => provider.models.filter((model) => model.on).length > SEARCH_FROM
        ? <ProviderMenu key={provider.id} provider={provider} value={value} onPick={onPick} />
        : <Models key={provider.id} provider={provider} value={value} onPick={onPick} />)}
      {missing.length > 0 && <>
        <div className={LABEL}>{onSetUp ? 'Connect' : 'Not set up'}</div>
        {missing.map((info) => <Choice key={info.id} icon={<Glyph name={info.id} size={14} />} name={info.id === 'compatible' ? 'Other (OpenAI-compatible)' : info.short} disabled={!onSetUp} onClick={() => onSetUp?.(info.id)} />)}
      </>}
    </DropdownMenuContent>
  </DropdownMenu>
}

// ponytail: a provider with few models lists them inline; big catalogs (OpenRouter) keep the searchable submenu.
function Models({ provider, value, onPick }: { provider: Provider; value: string | null; onPick: (key: string) => void }) {
  return <>
    <div className={cn(LABEL, 'flex items-center gap-1.5')}><Glyph name={provider.id} size={12} />{providerInfo(provider.id).short}</div>
    {provider.models.filter((model) => model.on).map((model) => {
      const key = modelKey({ provider: provider.id, model: model.id })
      return <Choice key={model.id} name={model.name} selected={key === value} onClick={() => onPick(key)} />
    })}
  </>
}

function ProviderMenu({ provider, value, onPick }: { provider: Provider; value: string | null; onPick: (key: string) => void }) {
  const models = provider.models.filter((model) => model.on)
  const labs = [...new Set(models.map(labOf))].map((lab) => models.filter((model) => labOf(model) === lab))
  const keyOf = (model: string) => modelKey({ provider: provider.id, model })
  const picked = models.find((model) => keyOf(model.id) === value)
  const priced = models.some((model) => prices(model))
  return <DropdownMenuFilter>
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="text-[13px]">
        <Glyph name={provider.id} size={14} />
        <span className="min-w-0 flex-1 truncate text-ink">{picked ? `${providerInfo(provider.id).short} · ${picked.name}` : providerInfo(provider.id).short}</span>
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
  const side = provider.kind === 'subscription' ? model.note : prices(model)
  return <DropdownMenuItem label={`${model.name} ${model.id}`} title={model.id} onClick={onClick}>
    <Glyph name={glyphOf({ provider: provider.id, model: model.id })} size={16} />
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
    <span className="grid w-3.5 shrink-0 place-items-center"><Glyph name={glyphOf(split)} size={14} /></span>
    <span className="min-w-0 flex-1 truncate text-left">{model?.name ?? known ?? split.model} <span className="text-mute">· {providerInfo(split.provider).short}</span></span>
    <I icon={UnfoldMoreIcon} size={12} className="text-mute" />
  </>
}

function Choice({ icon, name, selected = false, disabled = false, onClick }: { icon?: ReactNode; name: string; selected?: boolean; disabled?: boolean; onClick?: () => void }) {
  return <DropdownMenuItem className="text-[13px]" disabled={disabled} onClick={onClick}>
    {icon && <span className="grid w-3.5 shrink-0 place-items-center">{icon}</span>}
    <span className="min-w-0 flex-1 truncate text-ink">{name}</span>
    <span className="grid w-3.5 shrink-0 place-items-center">{selected && <I icon={Tick02Icon} size={14} className="text-ink" />}</span>
  </DropdownMenuItem>
}
