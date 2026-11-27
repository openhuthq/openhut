import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Cancel01Icon, File01Icon, Image01Icon } from '@hugeicons/core-free-icons'
import { MAX_FILE_BYTES, MAX_FILES, type ChatFile } from '@openhut/common/threads/thread.ts'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { I } from '@/components/kit'
import { deleteUpload, uploadFile } from '@/features/threads/api/threads'
import { RASTER } from '@/features/threads/files'
import { toastError, toastFailed } from '@/lib/toast'
import { cn } from '@/lib/utils'

type Attachment = { key: string; name: string; image: boolean; thumb?: string; file?: ChatFile }

export function useAttachments({ agentId, threadId }: { agentId: string; threadId: string }) {
  const [items, setItems] = useState<Attachment[]>([])
  const taken = useRef(new Set<string>())
  const current = useRef(items)
  current.current = items
  const forget = (path: string) => void deleteUpload({ agentId, threadId, path }).catch(() => undefined)
  const drop = (key: string) => {
    taken.current.delete(key)
    const item = current.current.find((each) => each.key === key)
    if (item?.thumb) URL.revokeObjectURL(item.thumb)
    setItems((list) => list.filter((each) => each.key !== key))
    return item
  }
  const add = (files: File[]) => {
    for (const file of files) {
      if (taken.current.size >= MAX_FILES) return toastFailed('Too many files', `Attach up to ${MAX_FILES} per message.`)
      if (file.size > MAX_FILE_BYTES) {
        toastFailed(`${file.name} is too big`, `Attach files up to ${MAX_FILE_BYTES >> 20} MB.`)
        continue
      }
      const key = crypto.randomUUID()
      const raster = RASTER.includes(file.type)
      taken.current.add(key)
      setItems((list) => [...list, { key, name: file.name, image: file.type.startsWith('image/'), thumb: raster ? URL.createObjectURL(file) : undefined }])
      uploadFile({ agentId, threadId, file }).then(
        (saved) => {
          if (!taken.current.has(key)) return forget(saved.path)
          setItems((list) => list.map((each) => each.key === key ? { ...each, file: saved } : each))
        },
        (error: Error) => {
          drop(key)
          toastError(error)
        },
      )
    }
  }
  const remove = (key: string) => {
    const item = drop(key)
    if (item?.file) forget(item.file.path)
  }
  const clear = () => {
    for (const item of current.current) if (item.thumb) URL.revokeObjectURL(item.thumb)
    taken.current.clear()
    current.current = []
    setItems([])
  }
  useEffect(() => () => {
    taken.current.clear()
    for (const item of current.current) if (item.file) forget(item.file.path)
  }, [])
  return { items, add, uploading: items.some((each) => !each.file), remove, clear }
}

export type Attachments = ReturnType<typeof useAttachments>

export function FileChip({ name, image, thumb, busy, onOpen, onRemove }: { name: string; image: boolean; thumb?: string; busy?: boolean; onOpen?: () => void; onRemove?: () => void }) {
  const icon = thumb ? <img src={thumb} alt="" className="size-[18px] shrink-0 rounded-[3px] object-cover" /> : <I icon={image ? Image01Icon : File01Icon} size={14} className="shrink-0 text-mute" />
  const body = <>{busy && !thumb ? <Spinner className="mt-0 size-3" /> : icon}<span className={cn('truncate', busy && thumb && 'text-mute')}>{name}</span>{busy && thumb && <Spinner className="mt-0 size-3" />}</>
  const chip = 'inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-md bg-soft px-2 align-middle font-sans text-[12.5px] text-ink'
  if (onOpen) return <Button type="button" variant="bare" className={cn(chip, 'cursor-pointer hover:bg-mid')} title={`Save ${name}`} onClick={onOpen}>{body}</Button>
  return <span className={chip} title={name}>{body}{onRemove && <Button type="button" variant="bare" className="-mr-1 grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-mute hover:text-ink" aria-label={`Remove ${name}`} title="Remove" onClick={onRemove}><I icon={Cancel01Icon} size={12} /></Button>}</span>
}

export function fileDrop(onFiles?: (files: File[]) => void) {
  return {
    onDragOver: (event: DragEvent) => {
      if (onFiles && event.dataTransfer.types.includes('Files')) event.preventDefault()
    },
    onDrop: (event: DragEvent) => {
      if (!onFiles || !event.dataTransfer.files.length) return
      event.preventDefault()
      onFiles(Array.from(event.dataTransfer.files))
    },
  }
}
