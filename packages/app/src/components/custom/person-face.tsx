import { folkFace } from '@/lib/folk-face'
import { cn } from '@/lib/utils'

export function PersonFace({ name, email, size = 36, className }: { name: string; email: string; size?: number; className?: string }) {
  return <svg role="img" aria-label={name} viewBox="0 0 100 100" width={size} height={size} strokeLinejoin="round" strokeLinecap="round"
    className={cn('block shrink-0 rounded-full select-none', className)} dangerouslySetInnerHTML={{ __html: `<title>${escapeText(name)}</title>${folkFace(email.toLowerCase())}` }} />
}

function escapeText(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}
