export const DEV_LABEL: string | undefined = import.meta.env.OPENHUT_DEV_LABEL || (import.meta.env.DEV ? 'Dev' : undefined)

export function DevPill() {
  if (!DEV_LABEL) return null
  const [, where] = DEV_LABEL.split(' · ')
  return <>
    <span className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px] bg-amber" />
    <span className="pointer-events-none fixed top-0 left-1/2 z-[100] -translate-x-1/2 rounded-b-md bg-amber px-2 text-[11px]/[16px] text-black"><b className="font-bold">DEV</b>{where && ` · ${where}`}</span>
  </>
}
