import { LockKeyIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog } from '@/components/confirm-button'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { I } from '@/components/kit'
import { useCloud, useSetEncryption } from '@/features/cloud/api'
import { Row } from '@/features/settings/kit'
import { open, useOpen } from '@/lib/router'
import { toast, toastError } from '@/lib/toast'

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

function EncryptionSetup() {
  const set = useSetEncryption()
  const close = () => open()
  const turnOn = () => set.mutate(true, {
    onSuccess: () => {
      toast('End-to-end encryption is on', 'Now save your new recovery key.')
      open('kit')
    },
    onError: toastError,
  })
  return <Dialog size="narrow" label="Turn on end-to-end encryption" onClose={close}>
    <DialogHead title="Turn on end-to-end encryption" subtitle="Only your devices and your recovery key can get in." onClose={close} />
    <ul className="m-0 grid gap-2 px-5 pt-4 pb-5 text-[13px]/[18px] text-body">
      <li>We delete our backup key and your account moves to a new key.</li>
      <li>Next, you save your new recovery key. Keep it safe: we can’t get you back in.</li>
      <li>New devices need one of your devices, or your recovery key, to get in.</li>
    </ul>
    <DialogFoot start={<Button type="button" variant="secondary" onClick={close}>Cancel</Button>}>
      <Button type="button" variant="primary" disabled={set.isPending} onClick={turnOn}>Turn on</Button>
    </DialogFoot>
  </Dialog>
}

function EncryptionOff() {
  const set = useSetEncryption()
  return <ConfirmDialog open onOpenChange={(still) => still || open()} question="Turn off end-to-end encryption?" detail="We’ll keep a backup key again, so we can get you back in." action="Turn off"
    onConfirm={async () => {
      await set.mutateAsync(false)
      toast('End-to-end encryption is off')
    }} />
}
