import { ChatSendMessageInputSchema, CommandAcceptedOutputSchema } from "@agentic-chat/contracts"

import { mvpUserProcedure, router } from "../trpc.js"

export const chatRouter = router({
  sendMessage: mvpUserProcedure
    .input(ChatSendMessageInputSchema)
    .output(CommandAcceptedOutputSchema)
    .mutation(({ ctx, input }) => ctx.services.sendMessage(input)),
})
