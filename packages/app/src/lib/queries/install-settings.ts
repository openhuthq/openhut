import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { InstallSettings, type UpdateInstallSettings } from '@openhut/common/team/team.ts'
import { request } from '@/lib/api-client'
import { INSTALL_SETTINGS_KEY } from '@/lib/query-keys'

export function useInstallSettings(enabled = true) {
  return useQuery({ queryKey: INSTALL_SETTINGS_KEY, queryFn: () => request({ schema: InstallSettings, path: '/api/install-settings' }), enabled })
}

export function useUpdateInstallSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateInstallSettings) => request({ schema: InstallSettings, path: '/api/install-settings', method: 'PATCH', body }),
    onSuccess: (saved) => client.setQueryData(INSTALL_SETTINGS_KEY, saved),
  })
}
