/**
 * Chrome extension connection: handshake token + connected devices.
 *
 * Connecting opens /extension-handshake?ext_token=… in a new tab; the
 * extension's background script exchanges the token for a long-lived,
 * rotating device token (see server/docs.md "Extension Devices").
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createExtensionTokenApi,
  listExtensionDevicesApi,
  revokeExtensionDeviceApi,
  type ExtensionDevice,
} from '@/api/extension'
import { queryKeys } from '@/lib/queryKeys'

export function useExtensionDevices() {
  return useQuery({
    queryKey: queryKeys.extension.devices(),
    queryFn: listExtensionDevicesApi,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
}

export function useConnectExtension() {
  return useMutation({
    mutationFn: async () => {
      const { token } = await createExtensionTokenApi()
      const dashboardURL = import.meta.env.VITE_APP_URL ?? window.location.origin
      const handshakeURL = `${dashboardURL}/extension-handshake?ext_token=${encodeURIComponent(token)}`
      window.open(handshakeURL, '_blank', 'noopener')
    },
  })
}

export function useRevokeExtensionDevice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => revokeExtensionDeviceApi(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: queryKeys.extension.devices() })
      const previous = qc.getQueryData<ExtensionDevice[]>(queryKeys.extension.devices())
      qc.setQueryData<ExtensionDevice[]>(queryKeys.extension.devices(), (old) => old?.filter((d) => d.id !== id))
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (context?.previous) qc.setQueryData(queryKeys.extension.devices(), context.previous)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.extension.devices() })
      qc.invalidateQueries({ queryKey: queryKeys.agent.overview() })
    },
  })
}
