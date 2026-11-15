import { Initial } from '@/components/initial'

export function OwnerChip({ id, name }: { id: string; name: string }) {
  return <span className="owner"><Initial id={id} email={name} size={20} />{name}</span>
}
