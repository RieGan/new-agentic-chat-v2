import {
  ApprovalApproveInputSchema,
  ApprovalEnvelopeSchema,
  ApprovalGetInputSchema,
  ApprovalListPendingInputSchema,
  ApprovalRejectInputSchema,
  type CanonicalEvent,
  RunSubscriptionInputSchema,
} from "@agentic-chat/contracts"
import { z } from "zod"

import { createTrackedEventStream, TrackedEventStreamSchema } from "../events/stream.js"
import { mvpAdminProcedure, router } from "../trpc.js"

const APPROVAL_EVENT_TYPES = new Set<CanonicalEvent["type"]>([
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "approval.expired",
])

export const approvalsRouter = router({
  listPending: mvpAdminProcedure
    .input(ApprovalListPendingInputSchema)
    .output(z.array(ApprovalEnvelopeSchema))
    .query(({ ctx, input }) => ctx.services.listPendingApprovals(input)),
  get: mvpAdminProcedure
    .input(ApprovalGetInputSchema)
    .output(ApprovalEnvelopeSchema)
    .query(({ ctx, input }) => ctx.services.approval(input)),
  approve: mvpAdminProcedure
    .input(ApprovalApproveInputSchema)
    .output(ApprovalEnvelopeSchema)
    .mutation(({ ctx, input }) => ctx.services.decideApproval(input)),
  reject: mvpAdminProcedure
    .input(ApprovalRejectInputSchema)
    .output(ApprovalEnvelopeSchema)
    .mutation(({ ctx, input }) => ctx.services.decideApproval(input)),
  subscribe: mvpAdminProcedure
    .input(RunSubscriptionInputSchema)
    .output(TrackedEventStreamSchema)
    .subscription(({ ctx, input, signal }) =>
      createTrackedEventStream({
        actor: ctx.actor,
        services: ctx.services,
        events: ctx.events,
        input: {
          runId: input.runId,
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          ...(input.lastEventId === undefined ? {} : { lastEventId: input.lastEventId }),
        },
        signal,
        include: (event) => APPROVAL_EVENT_TYPES.has(event.type),
      }),
    ),
})
