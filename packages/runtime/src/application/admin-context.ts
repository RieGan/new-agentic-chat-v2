import { z } from "zod"

const FixedAdminContextSchema = z.object({ actorId: z.literal("mvp_admin") }).strict()

export type FixedAdminContext = z.infer<typeof FixedAdminContextSchema>

export const requireFixedAdmin = (context: unknown, invalid: () => Error): FixedAdminContext => {
  const parsed = FixedAdminContextSchema.safeParse(context)
  if (!parsed.success) throw invalid()
  return parsed.data
}
