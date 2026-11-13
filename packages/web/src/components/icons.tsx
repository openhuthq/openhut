import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import {
  Activity01Icon, Add01Icon, AiMagicIcon, ArrowDown01Icon, ArrowExpand01Icon, ArrowRight01Icon, ArrowTurnBackwardIcon, ArrowUp02Icon, AtIcon, Calendar03Icon,
  Cancel01Icon, ChartColumnIcon, Clock01Icon, ComputerIcon, Copy01Icon, Delete02Icon, EraserIcon, File01Icon, File02Icon, Flag01Icon, FlashIcon, Globe02Icon,
  GridTableIcon, HierarchyIcon, Key01Icon, LaptopIcon, Link01Icon, LinkSquare02Icon, Logout03Icon, Message01Icon, MoreHorizontalIcon, NoteEditIcon,
  PencilEdit01Icon, PencilEdit02Icon, PlayIcon, Presentation01Icon, Robot01Icon, Search01Icon, SecurityCheckIcon, ServerStack01Icon, Settings01Icon,
  SidebarLeftIcon, SourceCodeIcon, SquareLock02Icon, StopIcon, Table01Icon, Tag01Icon, Tick02Icon, UnfoldMoreIcon, UserIcon, UserMultipleIcon, Wrench01Icon,
} from '@hugeicons/core-free-icons'

function icon(svg: IconSvgElement, size = 16, className?: string, strokeWidth = 1.5) {
  return <HugeiconsIcon icon={svg} size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" />
}

export const ICONS = {
  eraser: icon(EraserIcon, 15),
  enter: icon(ArrowTurnBackwardIcon, 15, undefined, 2),
  chat: icon(Message01Icon, 14),
  gear: icon(Settings01Icon, 14),
  up: icon(ArrowUp02Icon, 14, undefined, 2),
  plus: icon(Add01Icon, 14, undefined, 1.8),
  pencil: icon(PencilEdit02Icon, 14),
  copy: icon(Copy01Icon, 12),
  side: icon(SidebarLeftIcon, 16),
  chev: icon(ArrowRight01Icon, 14),
  check: icon(Tick02Icon, 10, undefined, 2.5),
  more: icon(MoreHorizontalIcon, 16, undefined, 2),
  trash: icon(Delete02Icon, 14),
  expand: icon(ArrowExpand01Icon, 12),
  x: icon(Cancel01Icon, 16),
  chevd: icon(ArrowDown01Icon, 14),
  play: icon(PlayIcon, 14),
  stop: icon(StopIcon, 14),
  updown: icon(UnfoldMoreIcon, 14),
  out: icon(Logout03Icon, 16),
  ext: icon(LinkSquare02Icon, 14),
}

export const FACT_ICONS = {
  status: icon(Activity01Icon, 16, 'fi'),
  model: icon(AiMagicIcon, 16, 'fi'),
  owner: icon(UserIcon, 16, 'fi'),
  code: icon(SourceCodeIcon, 16, 'fi'),
  computer: icon(ComputerIcon, 16, 'fi'),
}

export const SIZE_ICONS = {
  standard: icon(LaptopIcon),
  large: icon(ComputerIcon),
  xlarge: icon(ServerStack01Icon),
}

export const NAV_ICONS = {
  agents: icon(Robot01Icon),
  connections: icon(Link01Icon),
  people: icon(UserMultipleIcon),
  admin: icon(SecurityCheckIcon),
}

export const SETUP_ICONS = {
  search: icon(Search01Icon),
  pencil: icon(PencilEdit01Icon),
  table: icon(Table01Icon),
  play: icon(PlayIcon),
  file: icon(File01Icon),
  doc: icon(File02Icon),
  chart: icon(ChartColumnIcon),
  flag: icon(Flag01Icon),
  tag: icon(Tag01Icon),
  draft: icon(NoteEditIcon),
  plus: icon(Add01Icon),
  calendar: icon(Calendar03Icon),
  sheet: icon(GridTableIcon),
  slides: icon(Presentation01Icon),
  network: icon(HierarchyIcon),
  globe: icon(Globe02Icon),
  tools: icon(Wrench01Icon),
  message: icon(Message01Icon),
  at: icon(AtIcon),
  users: icon(UserMultipleIcon),
  user: icon(UserIcon),
  key: icon(Key01Icon),
  shield: icon(SecurityCheckIcon),
  bolt: icon(FlashIcon),
  clock: icon(Clock01Icon),
  check: icon(Tick02Icon),
  lock: icon(SquareLock02Icon),
}
export type SetupIcon = keyof typeof SETUP_ICONS
