import { BubbleChatIcon, Tick02Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import type { DeliveryTarget } from '@openhut/common/webhooks/webhook.ts'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Glyph } from '@/components/glyph'
import { I } from '@/components/kit'
import { FIELD_MENU, SOFT_TRIGGER } from '@/features/models/model-picker'
import { useDeliveryTargets } from '@/features/routines/api'
import { cn } from '@/lib/utils'

const GLYPHS = ['slack', 'whatsapp', 'telegram', 'discord'] as const

export function PlaceIcon({ platform, size = 14 }: { platform: string; size?: number }) {
  const glyph = GLYPHS.find((each) => each === platform)
  return glyph ? <Glyph name={glyph} size={size} /> : <I icon={BubbleChatIcon} size={size} className="text-hue-blue" />
}

export function TargetPicker({ agentId, value, place, platform, disabled, onPick }: { agentId: string; value: string; place: string; platform: string; disabled?: boolean; onPick: (target: DeliveryTarget) => void }) {
  const targets = useDeliveryTargets(agentId).data ?? []
  return <DropdownMenu>
    <DropdownMenuTrigger className={cn(SOFT_TRIGGER, 'w-[240px] gap-2')} disabled={disabled} aria-label={`Posts in: ${place}`}>
      <PlaceIcon platform={platform} />
      <span className="min-w-0 flex-1 truncate text-left">{place}</span>
      <I icon={UnfoldMoreIcon} size={12} className="text-mute" />
    </DropdownMenuTrigger>
    <DropdownMenuContent className={FIELD_MENU}>
      {targets.map((target) => <DropdownMenuItem key={target.id} className="text-[13px]" onClick={() => target.id !== value && onPick(target)}>
        <PlaceIcon platform={target.platform} />
        <span className="min-w-0 flex-1 truncate text-ink">{target.place}</span>
        <span className="grid w-3.5 shrink-0 place-items-center">{target.id === value && <I icon={Tick02Icon} size={14} className="text-ink" />}</span>
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>
}
