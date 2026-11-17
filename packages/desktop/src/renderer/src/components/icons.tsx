import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import {
  AiBrain01Icon, ArrowDown01Icon, ArrowRight01Icon, BookOpen01Icon, Cancel01Icon, CheckListIcon, CodeIcon, CommandIcon, Copy01Icon, File01Icon, FlashIcon,
  GitBranchIcon, Globe02Icon, HashtagIcon, Link01Icon, Mail01Icon, Megaphone01Icon, Notebook01Icon, PaintBoardIcon, Search01Icon, SourceCodeIcon,
  SquareLock02Icon, Tick02Icon, UserMultipleIcon, Video01Icon, Wrench01Icon,
} from '@hugeicons/core-free-icons'

function icon(svg: IconSvgElement, size = 16, className?: string, strokeWidth = 1.5) {
  return <HugeiconsIcon icon={svg} size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" />
}

export const ICONS = {
  copy: icon(Copy01Icon, 12),
  chev: icon(ArrowRight01Icon, 14),
  check: icon(Tick02Icon, 10, undefined, 2.5),
  x: icon(Cancel01Icon, 16),
  chevd: icon(ArrowDown01Icon, 14),
  globe: icon(Globe02Icon, 14),
  lock: icon(SquareLock02Icon, 13),
}

export const SETUP_ICONS = {
  globe: icon(Globe02Icon),
  users: icon(UserMultipleIcon),
  bolt: icon(FlashIcon),
  check: icon(Tick02Icon),
  lock: icon(SquareLock02Icon),
  hash: icon(HashtagIcon),
}
export type SetupIcon = keyof typeof SETUP_ICONS

export const STEP_ICONS = {
  code: icon(SourceCodeIcon, 13),
  web: icon(Globe02Icon, 13),
  file: icon(File01Icon, 13),
  memory: icon(AiBrain01Icon, 13),
  app: icon(Link01Icon, 13),
  find: icon(Search01Icon, 13),
  other: icon(Wrench01Icon, 13),
  blocked: icon(Cancel01Icon, 13, undefined, 2),
}

const SKILL_ICONS = new Map(Object.entries({
  'software-development': icon(CodeIcon),
  devops: icon(GitBranchIcon),
  productivity: icon(CheckListIcon),
  creative: icon(PaintBoardIcon),
  'autonomous-ai-agents': icon(AiBrain01Icon),
  apple: icon(CommandIcon),
  research: icon(BookOpen01Icon),
  email: icon(Mail01Icon),
  web: icon(Globe02Icon),
  'note-taking': icon(Notebook01Icon),
  'social-media': icon(Megaphone01Icon),
  media: icon(Video01Icon),
}))

export function skillIcon(category: string) {
  return SKILL_ICONS.get(category) ?? SETUP_ICONS.bolt
}
