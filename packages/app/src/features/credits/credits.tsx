import { useQuery } from '@tanstack/react-query'
import { Credits } from '@openhut/common/cloud/v1/identity.ts'
import { Section, Status } from '@/components/kit'
import { ListNote, Row, Rows } from '@/features/settings/kit'
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

export function CreditsSection() {
  const credits = useCredits()
  if (!credits) return null
  const tone = toneOf(credits)
  return <Section title="Credits">
    <Rows><Row icon={<CreditsRing credits={credits} className="size-[22px]" />} title="OpenHut credits" note={`${dollars(credits.balance)} left of ${dollars(credits.given)}`}>
      {{ ok: <Status tone="on">In use</Status>, low: <Status tone="wait">Running low</Status>, out: <Status tone="bad">Used up</Status> }[tone]}
    </Row></Rows>
    <ListNote>AI {dollars(credits.ai)} · Cloud {dollars(credits.computer)}</ListNote>
  </Section>
}

export function CreditsLine() {
  const credits = useCredits()
  if (!credits) return null
  const tone = toneOf(credits)
  return <a href="/settings/models" className={cn('flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[12.5px] no-underline hover:bg-hover', TEXT[tone])}>
    <CreditsRing credits={credits} className="size-4" /><span className="truncate">{tone === 'out' ? 'Out of credits' : `${dollars(credits.balance)} left`}</span>
  </a>
}
