import { useQuery } from '@tanstack/react-query'
import { Credits } from '@openhut/common/cloud/v1/identity.ts'
import { AiMagicIcon, CloudIcon } from '@hugeicons/core-free-icons'
import { HINT, I, Section, Status } from '@/components/kit'
import { Row, Rows } from '@/features/settings/kit'
import { request } from '@/lib/api-client'
import { CREDITS_KEY } from '@/lib/query-keys'
import { cn } from '@/lib/utils'

type Tone = 'ok' | 'low' | 'out'

export function useCredits() {
  return useQuery({ queryKey: CREDITS_KEY, queryFn: () => request({ schema: Credits, path: '/api/credits' }), retry: false, staleTime: 60_000, refetchInterval: 60_000 }).data
}

const TEXT: Record<Tone, string> = { ok: 'text-body', low: 'text-warning-strong', out: 'text-fail' }

function toneOf({ balance, given }: Credits): Tone {
  if (balance <= 0) return 'out'
  return balance < given / 5 ? 'low' : 'ok'
}
const dollars = (micros: number) => `$${(Math.max(0, micros) / 1_000_000).toFixed(2)}`

export function CreditsRing({ credits, className }: { credits: Credits; className?: string }) {
  const share = credits.given > 0 ? Math.min(1, Math.max(0, credits.balance / credits.given)) : 0
  const tone = toneOf(credits)
  return <svg viewBox="0 0 20 20" className={cn('shrink-0 -rotate-90', tone === 'ok' ? 'text-ink' : TEXT[tone], className)} role="img" aria-label={`${Math.round(share * 100)}% of credits left`}>
    <circle cx="10" cy="10" r="8" fill="none" strokeWidth="3" className="stroke-hair" />
    {share > 0 && <circle cx="10" cy="10" r="8" fill="none" strokeWidth="3" stroke="currentColor" strokeLinecap="round" pathLength={100} strokeDasharray={`${share * 100} 100`} />}
  </svg>
}

export function UsageSettings() {
  const credits = useCredits()
  if (!credits) return <p className={cn(HINT, 'px-2.5')}>Usage shows here once you use Cloud.</p>
  const tone = toneOf(credits)
  const spent = (amount: number) => <span className="font-mono text-xs tabular-nums">{dollars(amount)}</span>
  return <Section title="Credits">
    <Rows>
      <Row icon={<CreditsRing credits={credits} className="size-[22px]" />} title="OpenHut credits" note={`${dollars(credits.balance)} left of ${dollars(credits.given)}`}>
        {{ ok: <Status tone="on">In use</Status>, low: <Status tone="wait">Running low</Status>, out: <Status tone="bad">Used up</Status> }[tone]}
      </Row>
      <Row icon={<I icon={AiMagicIcon} size={20} className="text-hue-violet" />} title="AI">{spent(credits.ai)}</Row>
      <Row icon={<I icon={CloudIcon} size={20} className="text-hue-sky" />} title="Cloud">{spent(credits.computer)}</Row>
    </Rows>
  </Section>
}

export function CreditsLine({ className }: { className?: string }) {
  const credits = useCredits()
  if (!credits) return null
  const tone = toneOf(credits)
  return <a href="/settings/usage" className={cn('flex h-6 items-center gap-1.5 rounded-md px-1.5 text-[11.5px] tabular-nums no-underline hover:bg-hover', tone === 'ok' ? 'text-mute' : TEXT[tone], className)}>
    <CreditsRing credits={credits} className="size-3" /><span className="truncate">{tone === 'out' ? 'Out of credits' : `${dollars(credits.balance)} left`}</span>
  </a>
}
