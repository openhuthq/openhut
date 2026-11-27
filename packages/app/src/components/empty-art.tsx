import type { ReactElement } from 'react'

export type EmptyKind = 'webhooks' | 'routines' | 'memory' | 'skills' | 'vault' | 'activity' | 'connections'

const ink = '#0b0b0b'
const straw = '#f7c948'
const cream = '#fbe3c8'
const coral = '#ff5a3c'
const gray = '#d4d4d8'

function Mascot({ transform, mood = 'looking' }: { transform: string; mood?: 'looking' | 'asleep' | 'thinking' }) {
  return <g transform={transform}>
    <rect x='27' y='53' width='54' height='45' rx='10' fill={cream} strokeWidth='5.5' />
    <path d='M54 20 92 56q3 6-4 6H20q-7 0-4-6z' fill={straw} strokeWidth='5.5' />
    <path d='M37 41q4.5 4 9 0t9 0 9 0 9 0M25 52q4.8 4 9.7 0t9.7 0 9.7 0 9.7 0 9.7 0 9.7 0' strokeOpacity='.23' strokeWidth='2.8' />
    <path d='M54 20V9.5' strokeWidth='3.4' />
    <path d={mood === 'asleep' ? 'M55 10q-6 4-12 2l2-8z' : 'M55.5 9 69 13.5 55.5 18z'} fill={coral} />
    <g fill={coral} fillOpacity='.44' stroke='none'>
      <ellipse cx='37' cy='83' rx='4.3' ry='2.7' />
      <ellipse cx='71' cy='83' rx='4.3' ry='2.7' />
    </g>
    {mood === 'asleep' ? <>
      <path d='M39 76q5 4 10 0m10 0q5 4 10 0' strokeWidth='3.4' />
      <ellipse cx='54' cy='87' rx='3' ry='3.4' fill={ink} stroke='none' />
    </> : <>
      <g transform={mood === 'thinking' ? 'translate(2 -3)' : 'translate(2 0)'} stroke='none'>
        <ellipse cx='44' cy='76' rx='5.2' ry='6.2' fill={ink} />
        <ellipse cx='64' cy='76' rx='5.2' ry='6.2' fill={ink} />
        <circle cx='46' cy='73.5' r='2.1' fill='#fff' />
        <circle cx='66' cy='73.5' r='2.1' fill='#fff' />
      </g>
      <path d={mood === 'thinking' ? 'M52 86q3-2 6 0' : 'M49.5 85q4.5 4 9 0'} />
    </>}
  </g>
}

const scenes: Record<EmptyKind, ReactElement> = {
  webhooks: <>
    <path d='M68 93V68l21-9v34z' fill={cream} />
    <path d='M72 92V79a5 5 0 0 1 10 0v13z' fill='#fff' strokeWidth='2.5' />
    <path d='m65 70 23-12' strokeWidth='4' />
    <Mascot transform='translate(154 9) scale(-.86 .86)' />
    <path d='M43 70h6v23h-6z' fill={cream} />
    <path d='M32 70v-9a10 10 0 0 1 10-10h12a10 10 0 0 1 10 10v9z' fill={straw} />
    <path d='M32 70v-9a10 10 0 0 1 20 0v9z' fill='#fff' />
    <path d='M37 61h10' strokeWidth='2.5' />
    <path d='M56 61V45h9v6h-9' fill={coral} />
    <path d='M7 43c9 0 11-12 19-12h7' strokeDasharray='1 5' strokeWidth='2.4' />
    <path className='motion-safe:animate-[pulse_1.4s_ease-in-out_2]' d='m45 20-10 14h7l-2 9 13-16h-9z' fill={straw} strokeWidth='2.5' />
  </>,
  routines: <>
    <Mascot transform='translate(8 13) rotate(-5 54 94) scale(.83)' mood='asleep' />
    <path d='M79 39h7l-7 8h7m6-22h9l-9 10h9' strokeWidth='2.8' />
    <g transform='rotate(8 115 74)'>
      <path d='m104 87-3 7m25-7 3 6m-23-36-3-5m19 5 4-5' />
      <path d='M94 57q-1-13 12-10l3 3zm26-8q10-8 16 4l-2 3z' fill={straw} />
      <circle cx='115' cy='73' r='18' fill={straw} />
      <circle cx='115' cy='73' r='14' fill='#fff' strokeWidth='2' />
      <path d='M115 63v10l7 4' />
      <circle cx='115' cy='73' r='2' fill={ink} stroke='none' />
    </g>
  </>,
  memory: <>
    <Mascot transform='translate(6 11) scale(.85)' mood='thinking' />
    <g transform='translate(4 2) rotate(9 85 76)'>
      <rect x='67' y='61' width='35' height='31' rx='3' fill={straw} />
      <path d='M68 60h31v21l-6 7H68z' fill='#fff' />
      <path d='M93 87v-6h6M74 57v6m8-6v6m8-6v6' strokeWidth='2.5' />
    </g>
    <path d='M67 82q6 3 10-1 4-2 5 1 2 5-7 8-6 1-8-3' fill={cream} />
    <path d='M101 82q6-3 7 1t-6 6q-5 1-4-3z' fill={cream} />
    <g fill='#fff' strokeWidth='2.5'>
      <circle cx='82' cy='48' r='2' />
      <circle cx='90' cy='42' r='3.5' />
      <path d='M99 38c-9-1-10-13-2-17 0-8 10-12 16-7 7-6 16-2 18 4 10 0 14 11 7 17-2 6-10 8-16 5-8 5-16 4-23-2z' />
    </g>
    <path d='M106 27h.1m9-.1h.1m9-.1h.1' strokeWidth='4' />
  </>,
  skills: <>
    <Mascot transform='translate(2 10) scale(.85)' />
    <path d='M90 89v5m50-5v5' strokeWidth='5' />
    <rect x='85' y='37' width='59' height='53' rx='3' fill={cream} />
    <path d='M91 43h47v18H91zm0 23h47v18H91z' fill='#fff' strokeWidth='2.5' />
    <g transform='translate(3) rotate(18 125 82)'>
      <rect x='121' y='64' width='9' height='19' rx='1.5' fill={straw} strokeWidth='2.5' />
      <path d='M122 68h7' strokeWidth='2' />
    </g>
  </>,
  vault: <>
    <Mascot transform='translate(0 10) scale(.85)' />
    <path d='M97 89v5h7v-5m27 0v5h7v-5' fill={gray} />
    <rect x='92' y='47' width='51' height='44' rx='6' fill={gray} />
    <rect x='98' y='53' width='37' height='32' rx='3' fill='#fff' />
    <path d='M96 60h4m-4 17h4' strokeWidth='4' />
    <path d='M121 66a4 4 0 1 0-6 3.5l-1 6.5h6l-1-6.5a4 4 0 0 0 2-3.5z' fill={ink} stroke='none' />
    <g transform='rotate(-12 74 64)'>
      <path d='M72 74a5.5 5.5 0 1 1 5 0v5h4v4h-4v3h-5z' fill={straw} strokeWidth='2.5' />
      <path d='M74 62v6' strokeWidth='2.5' />
    </g>
  </>,
  activity: <>
    <g strokeWidth='2'>
      <path d='M109 69a10 10 0 0 1 20 0' fill={straw} />
      <path d='M84 69h56m4 0h6m-51 6h14m6 0h6m-18 5h7' />
      <path d='M120 46q3-1 5 2 1-4 5-4' />
    </g>
    <Mascot transform='translate(4 10) scale(.85)' />
    <path d='M39 82q-9 0-8-7t7-6m22 14q9 5 13-6' strokeWidth='4' />
    <g transform='rotate(-7 58 72)'>
      <path d='m38 70 11-6 7 14-14 4q-7-1-4-12zm22 0 11-6 7 14-14 4q-7-1-4-12z' fill={straw} />
      <path d='M54 71q7-5 14 0' strokeWidth='5' />
      <g fill={gray}>
        <circle cx='53' cy='70' r='8.5' />
        <circle cx='75' cy='70' r='8.5' />
      </g>
      <path d='M49 70q0-4 4-4m18 4q0-4 4-4' stroke='#fff' strokeWidth='2.5' />
    </g>
  </>,
  connections: <>
    <Mascot transform='translate(3 10) scale(.85)' />
    <path d='M59 94c5 4 14 3 20-1 11-8 17-4 23-1 13 7 23-6 15-12-8-7-17 7-28 1-6-3-6-9-3-15' strokeWidth='3.5' />
    <g transform='rotate(-26 93 63)'>
      <path d='M100 60h12m-12 8h12' strokeWidth='4' />
      <path d='M77 64h8' strokeWidth='6' />
      <path d='M81 59h6v-4h16v18H87v-4h-6z' fill={straw} />
      <path d='M97 57v14' strokeWidth='2' />
    </g>
    <path d='M70 77q7 1 12-8 2-4 5-2 4 2 0 8-6 9-15 8' fill={cream} />
    <rect x='126' y='33' width='22' height='27' rx='6' fill='#fff' strokeWidth='2.5' />
    <path d='M133 43v5m8-5v5' />
  </>,
}

export function EmptyArt({ kind, className }: { kind: EmptyKind; className?: string }): ReactElement {
  return <svg viewBox='0 0 160 112' width='160' height='112' className={className} role='img' aria-hidden='true' fill='none' stroke={ink} strokeWidth='3' strokeLinecap='round' strokeLinejoin='round'>
    <ellipse cx='80' cy='95' rx='61' ry='3' fill={ink} fillOpacity='.07' stroke='none' />
    {scenes[kind]}
  </svg>
}

export function EmptyScene({ kind, title, line }: { kind: EmptyKind; title: string; line: string }) {
  return <div className='flex flex-1 flex-col items-center justify-center gap-1.5 px-6 pb-10 text-center'>
    <EmptyArt kind={kind} className='mb-2 h-28 w-40' />
    <b className='text-[15px] font-semibold text-ink'>{title}</b>
    <p className='m-0 max-w-[480px] text-[13px]/[1.5] text-pretty text-mute'>{line}</p>
  </div>
}

export function SceneLoading() {
  return <div role='status' aria-label='Loading' className='flex flex-1 items-center justify-center pb-10'><span className='size-4 animate-spin rounded-full border-2 border-mid border-t-ink' /></div>
}
