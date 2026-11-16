import { Initial } from '@/components/initial'

export function OwnerChip({ id, name }: { id: string; name: string }) {
  return <span className="inline-flex items-center gap-2"><Initial id={id} email={name} size={20} />{name}</span>
}
