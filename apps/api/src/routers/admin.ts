import { AdminCommandEnvelopeSchema, AdminCommandInputSchema } from "@agentic-chat/contracts"

import { mvpAdminProcedure, router } from "../trpc.js"

export const adminRouter = router({
  command: router({
    sendHidden: mvpAdminProcedure
      .input(AdminCommandInputSchema)
      .output(AdminCommandEnvelopeSchema)
      .mutation(({ ctx, input }) => ctx.services.sendHidden(input)),
  }),
})
