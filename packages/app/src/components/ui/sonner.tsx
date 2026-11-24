import type { CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { Alert02Icon, CheckmarkCircle02Icon, InformationCircleIcon } from '@hugeicons/core-free-icons'
import { I } from '@/components/kit'
import { Spinner } from '@/components/ui/spinner'

const ICONS: ToasterProps['icons'] = {
  success: <I icon={CheckmarkCircle02Icon} size={20} className="text-hue-green" />,
  error: <I icon={Alert02Icon} size={20} className="text-fail" />,
  warning: <I icon={Alert02Icon} size={20} className="text-hue-amber" />,
  info: <I icon={InformationCircleIcon} size={20} className="text-hue-slate" />,
  loading: <Spinner className="mt-0 size-5" />,
}

export function Toaster(props: ToasterProps) {
  return <Sonner theme="system" position="bottom-right" className="toaster group" icons={ICONS} style={{ '--normal-bg': 'var(--card)', '--normal-text': 'var(--ink)', '--normal-border': 'var(--hair)', '--border-radius': 'var(--radius)' } as CSSProperties} toastOptions={{ classNames: { toast: '!flex-wrap !items-center !gap-x-3 [&_[data-button]~[data-button]]:!ml-1.5', content: '!grow !basis-[calc(100%-44px)]', icon: '!m-0 [&_svg]:!m-0 !size-8 !shrink-0 !items-center !justify-center', description: '!text-mute', actionButton: '!mt-1 !h-7 !rounded-full !bg-ink !px-3 !text-card', cancelButton: '!mt-1 !h-7 !rounded-full !bg-soft !px-3 !text-body' } }} {...props} />
}
