import monkey from '@/monkey.svg?raw'

export function Monkey({ className = 'monkey' }: { className?: string }) {
  return <span className={className} aria-hidden="true" dangerouslySetInnerHTML={{ __html: monkey }} />
}
