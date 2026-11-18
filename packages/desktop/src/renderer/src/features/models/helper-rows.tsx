import type { Provider } from '@openhut/common/models/provider.ts'
import { HELPER_TASKS, type HelperModels, type HelperSlot } from '@openhut/common/agents/agent.ts'
import { automatic } from '@/features/models/labels'
import { ModelPicker, SOFT_TRIGGER, SPARKLE } from '@/features/models/model-picker'
import { cn } from '@/lib/utils'

export function HelperRows({ providers, main, values, who, disabled, onPick }: {
  providers: Provider[] | undefined
  main: string
  values: Partial<HelperModels>
  who: string
  disabled?: boolean
  onPick: (slot: HelperSlot, key: string | null) => void
}) {
  const auto = automatic({ providers, key: main })
  return <div className="flex w-full flex-col gap-3 text-left">
    {HELPER_TASKS.map((task) => <div key={task.slot} className="flex flex-wrap items-center justify-between gap-3">
      <span className="grid min-w-0 flex-1 basis-[180px]"><span className="text-[13px]/[18px] font-medium">{task.label}</span><span className="text-[12px]/[16px] text-mute">{task.hint}</span></span>
      <ModelPicker providers={providers} value={values[task.slot] ?? null} onPick={(key) => onPick(task.slot, key)} disabled={disabled} className={cn(SOFT_TRIGGER, 'w-[200px]')}
        label={task.label} title={`${who} uses for ${task.label.toLowerCase()}`} none={{ name: 'Automatic', note: `${auto.name}, a fast model from the same provider`, icon: SPARKLE }} />
    </div>)}
  </div>
}
