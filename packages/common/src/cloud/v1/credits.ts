import * as z from 'zod/mini'

// C2: the person's Cloud computer, one Boat VM. creating until it joins with its server code, then running.
export const CloudComputer = z.object({ object: z.literal('cloud_computer'), state: z.string(), device: z.nullable(z.string()) })
export type CloudComputer = z.infer<typeof CloudComputer>
