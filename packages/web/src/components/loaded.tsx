import type { ReactNode } from 'react'
import { ErrorNote } from '@/components/error-note'

export function Loaded<T>({ query, children }: { query: { error: Error | null; data: T | undefined }; children: (data: T) => ReactNode }) {
  if (query.error) return <ErrorNote message={query.error.message} />
  if (query.data === undefined) return null
  return children(query.data)
}
