import type { CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { Alert02Icon, CheckmarkCircle02Icon, InformationCircleIcon } from '@hugeicons/core-free-icons'
import { I } from '@/components/kit'
import { Spinner } from '@/components/ui/spinner'

const ICONS: ToasterProps['icons'] = {
  success: <I icon={CheckmarkCircle02Icon} size={18} className="text-hue-green" />,
  error: <I icon={Alert02Icon} size={18} className="text-fail" />,
  warning: <I icon={Alert02Icon} size={18} className="text-hue-amber" />,
  info: <I icon={InformationCircleIcon} size={18} className="text-hue-slate" />,
  loading: <Spinner className="mt-0" />,
}

export function Toaster(props: ToasterProps) {
  return <Sonner theme="system" position="bottom-right" className="toaster group" icons={ICONS} style={{ '--normal-bg': 'var(--card)', '--normal-text': 'var(--ink)', '--normal-border': 'var(--hair)', '--border-radius': 'var(--radius)' } as CSSProperties} toastOptions={{ classNames: { toast: '!flex-wrap !items-start !gap-x-2.5 [&_[data-button]~[data-button]]:!ml-1.5', content: '!grow !basis-[calc(100%-44px)]', description: '!text-mute', actionButton: '!mt-1 !h-7 !rounded-full !bg-ink !px-3 !text-card', cancelButton: '!mt-1 !h-7 !rounded-full !bg-soft !px-3 !text-body' } }} {...props} />
}
