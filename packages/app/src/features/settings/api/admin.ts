import { useMutation } from '@tanstack/react-query'
import * as z from 'zod/mini'
import { request } from '@/lib/api-client'
import { toast, toastError } from '@/lib/toast'

const TestEmail = z.object({ object: z.literal('test_email'), to: z.string() })

export function useTestEmail() {
  return useMutation({
    mutationFn: () => request({ schema: TestEmail, path: '/api/install-settings/test-emails', method: 'POST' }),
    onSuccess: ({ to }) => toast('Test email sent', `Check ${to}.`),
    onError: toastError,
  })
}
