import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const merge = extendTailwindMerge({ extend: { theme: { 'font-weight': ['book'], shadow: ['menu', 'pop', 'dialog', 'sheet'] } } })

export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs))
}
