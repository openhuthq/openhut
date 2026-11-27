import { BubbleChatIcon } from '@hugeicons/core-free-icons'
import { Glyph } from '@/components/glyph'
import { I } from '@/components/kit'

const GLYPHS = ['slack', 'whatsapp', 'telegram', 'discord'] as const

export function PlaceIcon({ platform, size = 14 }: { platform: string; size?: number }) {
  const glyph = GLYPHS.find((each) => each === platform)
  return glyph ? <Glyph name={glyph} size={size} /> : <I icon={BubbleChatIcon} size={size} className="text-hue-blue" />
}
