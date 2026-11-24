import { LaptopIcon, PlusSignIcon, ServerStack01Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Choice, I, MenuCard } from '@/components/kit'
import { runsOnNote } from '@/features/computers/api'
import { SOFT_TRIGGER } from '@/features/models/model-picker'
import type { Computer } from '@/lib/openhut'
import { cn } from '@/lib/utils'

export function iconOf(computer: Computer) {
  return computer.kind === 'server' || computer.server ? ServerStack01Icon : LaptopIcon
}

export function ComputerPicker({ computers, value, onPick, onAdd, title, className }: { computers: Computer[]; value: string; onPick: (id: string) => void; onAdd?: () => void; title: string; className?: string }) {
  const picked = computers.find((each) => each.id === value) ?? computers[0]
  return <DropdownMenu>
    <DropdownMenuTrigger aria-label={`Where it runs: ${picked.name}`} className={cn(SOFT_TRIGGER, className)}>
      <span className="flex min-w-0 items-center gap-2"><I icon={iconOf(picked)} size={15} /><span className="truncate">{picked.name}{picked.kind === 'server' && <span className="text-mute"> · Linux server</span>}</span></span><I icon={UnfoldMoreIcon} size={12} className="text-mute" />
    </DropdownMenuTrigger>
    <MenuCard title={title} align="end">
      {computers.map((each) => <Choice key={each.id} icon={<I icon={iconOf(each)} size={15} />} name={each.name} note={runsOnNote(each)}
        selected={each.id === picked.id} disabled={!each.online} onClick={() => onPick(each.id)} />)}
      {onAdd && <><DropdownMenuSeparator /><DropdownMenuItem className="h-8 gap-2 text-[13px]" onClick={onAdd}><I icon={PlusSignIcon} size={14} className="text-pass" />Add a computer…</DropdownMenuItem></>}
    </MenuCard>
  </DropdownMenu>
}
