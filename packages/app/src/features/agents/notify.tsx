import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Tick02Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import { List } from '@openhut/common/api.ts'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import { ErrorNote } from '@/components/error-note'
import { DialogCard, I, Loading } from '@/components/kit'
import { Face } from '@/features/agents/face'
import { FIELD_MENU, SOFT_TRIGGER } from '@/features/models/model-picker'
import { PlaceIcon } from '@/features/routines/target-picker'
import { Place } from '@openhut/common/channels/channel.ts'
import { NotifySettings, placeKey, placeName, samePlace } from '@/features/threads/places'
import { request } from '@/lib/api-client'
import { formValues } from '@/lib/form'
import { cn } from '@/lib/utils'

const PLACE_LIST = List(Place)
const notifyKey = (agentId: string) => ['notify', agentId]

function usePlaces(agentId: string) {
  return useQuery({
    queryKey: ['places', agentId],
    queryFn: () => request({ schema: PLACE_LIST, of: agentId, path: `/api/agents/${encodeURIComponent(agentId)}/places` }).then((page) => page.data),
  })
}

export function useNotify(agentId: string, enabled = true) {
  return useQuery({
    queryKey: notifyKey(agentId),
    enabled,
    retry: false,
    queryFn: () => request({ schema: NotifySettings, of: agentId, path: `/api/agents/${encodeURIComponent(agentId)}/notify` }),
  })
}

function useSaveNotify(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: NotifySettings) => request({ schema: NotifySettings, of: agentId, path: `/api/agents/${encodeURIComponent(agentId)}/notify`, method: 'PUT', body }),
    onSuccess: (settings) => client.setQueryData(notifyKey(agentId), settings),
  })
}

export function PlacePicker({ agentId, value, none, label, disabled, className, onPick }: { agentId: string; value: Place | null; none: string; label: string; disabled?: boolean; className?: string; onPick: (place: Place | null) => void }) {
  const places = usePlaces(agentId).data ?? []
  const options = value && !places.some((place) => samePlace(place, value)) ? [value, ...places] : places
  return <DropdownMenu>
    <DropdownMenuTrigger className={cn(SOFT_TRIGGER, 'gap-2', className)} disabled={disabled} aria-label={`${label}: ${value ? placeName(value) : none}`}>
      <PlaceIcon platform={value?.platform ?? 'app'} />
      <span className="min-w-0 flex-1 truncate text-left">{value ? placeName(value) : none}</span>
      <I icon={UnfoldMoreIcon} size={12} className="text-mute" />
    </DropdownMenuTrigger>
    <DropdownMenuContent className={FIELD_MENU}>
      <PlaceOption name={none} platform="app" picked={!value} onClick={() => value && onPick(null)} />
      {options.map((place) => <PlaceOption key={placeKey(place)} name={placeName(place)} platform={place.platform} picked={samePlace(place, value)} onClick={() => !samePlace(place, value) && onPick(place)} />)}
    </DropdownMenuContent>
  </DropdownMenu>
}

function PlaceOption({ name, platform, picked, onClick }: { name: string; platform: string; picked: boolean; onClick: () => void }) {
  return <DropdownMenuItem className="text-[13px]" onClick={onClick}>
    <PlaceIcon platform={platform} />
    <span className="min-w-0 flex-1 truncate text-ink">{name}</span>
    <span className="grid w-3.5 shrink-0 place-items-center">{picked && <I icon={Tick02Icon} size={14} className="text-ink" />}</span>
  </DropdownMenuItem>
}

export function NotifyDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const notify = useNotify(agent.id)
  return <DialogCard onClose={onClose} className="w-[560px]">
    <div className="flex items-center gap-3"><Face agent={agent} size={40} /><DialogTitle className="text-[18px] font-semibold">Notify me</DialogTitle></div>
    <ErrorNote message={notify.error?.message} />
    {!notify.data && !notify.error && <Loading />}
    {notify.data && <NotifyForm agent={agent} settings={notify.data} onClose={onClose} />}
  </DialogCard>
}

function NotifyForm({ agent, settings, onClose }: { agent: Agent; settings: NotifySettings; onClose: () => void }) {
  const save = useSaveNotify(agent.id)
  const [place, setPlace] = useState(settings.default)
  return <form className="contents" onSubmit={(event) => save.mutate({ default: place, rules: formValues(event)('rules') }, { onSuccess: onClose })}>
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px]/[16px] text-mute">Usually in</span>
      <PlacePicker agentId={agent.id} value={place} none="Only here in the web app" label="Usually in" className="w-full" onPick={setPlace} />
    </div>
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px]/[16px] text-mute">Rules</span>
      <Textarea name="rules" aria-label="Rules" maxLength={4000} defaultValue={settings.rules} rows={5} placeholder="Post incidents and new Linear issues in #on-call. Everything else stays here."
        className="min-h-[132px] rounded-lg font-sans text-[14px]/[1.55]" />
    </div>
    <ErrorNote message={save.error?.message} />
    <div className="flex items-center gap-2">
      <span className="ml-auto flex shrink-0 gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={save.isPending}>Save</Button></span>
    </div>
  </form>
}
