import {
  ConversationCreateInputSchema,
  ConversationGetInputSchema,
  ConversationProjectionSchema,
  ConversationSummarySchema,
  ConversationsListInputSchema,
  ConversationsListOutputSchema,
} from "@agentic-chat/contracts"

import { mvpUserProcedure, mvpViewerProcedure, router } from "../trpc.js"

export const conversationsRouter = router({
  create: mvpUserProcedure
    .input(ConversationCreateInputSchema)
    .output(ConversationSummarySchema)
    .mutation(({ ctx, input }) => ctx.services.createConversation(input)),
  get: mvpUserProcedure
    .input(ConversationGetInputSchema)
    .output(ConversationProjectionSchema)
    .query(({ ctx, input }) => ctx.services.conversation(input)),
  list: mvpViewerProcedure
    .input(ConversationsListInputSchema)
    .output(ConversationsListOutputSchema)
    .query(({ ctx, input }) => ctx.services.listConversations(input)),
})
