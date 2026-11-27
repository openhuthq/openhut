import { createContext, useContext } from 'react'
import { navigate } from '@/lib/router'

export const SidebarContext = createContext<{ collapsed: boolean } | null>(null)

export const PhoneBack = createContext(() => navigate('/'))

export function usePhoneBack() {
  return useContext(PhoneBack)
}
