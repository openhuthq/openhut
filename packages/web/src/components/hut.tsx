import hut from '@/hut.svg?raw'

export function Hut({ className = 'hut' }: { className?: string }) {
  return <span className={className} aria-hidden="true" dangerouslySetInnerHTML={{ __html: hut }} />
}
