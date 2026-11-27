import { folkFace } from '@/lib/folk-face'
import { cn } from '@/lib/utils'

export function PersonFace({ name, email, size = 36, className }: { name: string; email: string; size?: number; className?: string }) {
  return <span role="img" aria-label={name} title={name} className={cn('block shrink-0 rounded-full select-none', className)} style={{ width: size, height: size }}>
    <svg viewBox="0 0 100 100" width={size} height={size} strokeLinejoin="round" strokeLinecap="round" aria-hidden className="block" dangerouslySetInnerHTML={{ __html: folkFace(email.toLowerCase()) }} />
  </span>
}
