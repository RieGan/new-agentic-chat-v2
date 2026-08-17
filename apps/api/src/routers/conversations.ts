import { ConversationGetInputSchema, ConversationProjectionSchema } from "@agentic-chat/contracts"

import { mvpUserProcedure, router } from "../trpc.js"

export const conversationsRouter = router({
  get: mvpUserProcedure
    .input(ConversationGetInputSchema)
    .output(ConversationProjectionSchema)
    .query(({ ctx, input }) => ctx.services.conversation(input)),
})
