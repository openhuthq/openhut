import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DevPill } from '@/components/dev-pill'
import { ErrorBoundary } from '@/components/error-boundary'
import { Toaster } from '@/components/ui/sonner'
import { RequestError } from '@/lib/api-client'

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: (failures, error) => failures < 2 && !(error instanceof RequestError && error.status < 500) } },
})

export function AppProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}><ErrorBoundary>{children}</ErrorBoundary><DevPill /><Toaster /></QueryClientProvider>
}
