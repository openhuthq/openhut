const bridge: { dev?: string } | undefined = Reflect.get(window, 'openhut')

export const DEV_LABEL: string | undefined = bridge?.dev ?? import.meta.env.VITE_OPENHUT_DEV ?? (import.meta.env.DEV ? 'Dev' : undefined)

export function DevPill() {
  if (!DEV_LABEL) return null
  const [, where] = DEV_LABEL.split(' · ')
  return <>
    <span className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px] bg-amber" />
    <span className="pointer-events-none fixed top-2.5 right-3 z-[100] rounded-full bg-amber px-2.5 py-0.5 text-[12px]/[18px] text-black shadow-menu"><b className="font-bold">DEV</b>{where && ` · ${where}`}</span>
  </>
}
