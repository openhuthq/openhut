import { Soon } from '@/components/soon'

export function SoonButton({ label, className = 'btn sec sm' }: { label: string; className?: string }) {
  return <><Soon /><button type="button" className={className} disabled>{label}</button></>
}
