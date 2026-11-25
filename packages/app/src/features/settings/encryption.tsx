import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download04Icon, FingerPrintIcon, LockKeyIcon, Tick02Icon } from '@hugeicons/core-free-icons'
import { kitText } from '@openhut/common/vault/kit-file.ts'
import { toBase64 } from '@openhut/common/vault/public.ts'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog } from '@/components/confirm-button'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { I, PILL } from '@/components/kit'
import { useCloud, useEncryptionPasskey, usePrepareEncryption, useSetEncryption } from '@/features/cloud/api'
import { download } from '@/features/cloud/sign-in'
import { Row } from '@/features/settings/kit'
import { open, useOpen } from '@/lib/router'
import { toast, toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

export function useEncryption(): boolean {
  return Boolean(useCloud().data?.encryption)
}

export function EncryptionRow() {
  const on = useEncryption()
  const opened = useOpen()
  return <Row icon={<I icon={LockKeyIcon} size={20} className="text-hue-green" />} title="End-to-end encryption"
    note={on ? 'Only your devices and your recovery key can get in.' : 'We keep a backup key so you can always get back in.'}>
    <Switch checked={on} aria-label="End-to-end encryption" onCheckedChange={() => open(on ? 'encryption-off' : 'encryption-on')} />
    {opened === 'encryption-on' && <EncryptionSetup />}
    {opened === 'encryption-off' && <EncryptionOff />}
  </Row>
}

function usePlatformTouch() {
  return useQuery({ queryKey: ['platform-authenticator'], queryFn: async () => Boolean(await globalThis.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.()), staleTime: Infinity }).data
}

function EncryptionSetup() {
  const email = useCloud().data?.email ?? ''
  const prepare = usePrepareEncryption()
  const passkey = useEncryptionPasskey()
  const set = useSetEncryption()
  const platform = usePlatformTouch()
  const [saved, setSaved] = useState(false)
  const [touch, setTouch] = useState(false)
  const kit = prepare.data
  const close = () => open()
  useEffect(() => prepare.mutate(undefined, { onError: toastError }), [])
  const save = () => {
    if (!kit) return
    download({ name: `OpenHut Recovery Key (${email}).txt`, text: kitText({ email, madeAt: kit.madeAt, device: kit.device, kitId: kit.kitId, words: kit.words }) })
    setSaved(true)
  }
  const addTouch = () => void newPasskey(email).then((made) => passkey.mutateAsync(made)).then(() => setTouch(true), toastError)
  const finish = () => set.mutate(true, {
    onSuccess: () => {
      toast('End-to-end encryption is on', 'New devices need your Touch ID or your recovery key to get in.')
      close()
    },
    onError: toastError,
  })
  const touchNote = platform === false ? 'This device has no Touch ID. Set it up on a Mac or phone that has it.' : saved ? 'You’ll use it to let in new devices.' : 'Download your recovery key first.'
  return <Dialog size="narrow" label="Turn on end-to-end encryption" onClose={close}>
    <DialogHead title="Turn on end-to-end encryption" subtitle="Only your devices and your recovery key can get in." onClose={close} />
    <div className="grid gap-2 px-5 pt-4 pb-5">
      <Step done={saved} icon={Download04Icon} title="Download your recovery key" note="Store it somewhere safe, in case you lose your laptop."
        action={<Button type="button" variant="secondary" className={PILL} disabled={!kit} onClick={save}>{saved ? 'Download again' : 'Download'}</Button>} />
      <Step done={touch} icon={FingerPrintIcon} title="Set up Touch ID" note={touchNote}
        action={<Button type="button" variant="secondary" className={PILL} disabled={!saved || platform === false || touch || passkey.isPending} onClick={addTouch}>Set up</Button>} />
    </div>
    <DialogFoot start={<Button type="button" variant="secondary" onClick={close}>Cancel</Button>}>
      <Button type="button" variant="primary" disabled={!saved || !touch || set.isPending} onClick={finish}>Turn on</Button>
    </DialogFoot>
  </Dialog>
}

function Step({ done, icon, title, note, action }: { done: boolean; icon: typeof LockKeyIcon; title: string; note: string; action: ReactNode }) {
  return <div className="flex items-start gap-3 rounded-xl border border-hair px-3.5 py-3">
    <span className={cn('mt-0.5 grid size-6 shrink-0 place-items-center rounded-full', done ? 'bg-pass text-white' : 'bg-soft text-mute')}><I icon={done ? Tick02Icon : icon} size={14} /></span>
    <span className="flex min-w-0 flex-1 flex-col"><span className="text-[13px]/[18px] font-medium">{title}</span><span className="text-[12px]/[16px] text-mute">{note}</span></span>
    {action}
  </div>
}

async function newPasskey(email: string): Promise<{ id: string; publicKey: string }> {
  const made = await navigator.credentials.create({ publicKey: {
    rp: { name: 'OpenHut', id: location.hostname },
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name: email, displayName: email },
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'required' },
  } })
  const key = made instanceof PublicKeyCredential && made.response instanceof AuthenticatorAttestationResponse ? made.response.getPublicKey() : null
  if (!made || !key) throw new Error('Touch ID wasn’t set up. Try again.')
  return { id: made.id, publicKey: toBase64(new Uint8Array(key)) }
}

function EncryptionOff() {
  const set = useSetEncryption()
  return <ConfirmDialog open onOpenChange={(still) => still || open()} question="Turn off end-to-end encryption?" detail="We’ll keep a backup key again, so we can get you back in." action="Turn off"
    onConfirm={async () => {
      await set.mutateAsync(false)
      toast('End-to-end encryption is off')
    }} />
}
