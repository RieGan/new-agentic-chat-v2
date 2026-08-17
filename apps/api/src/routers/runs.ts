import {
  RunGetInputSchema,
  RunProjectionSchema,
  RunSubscriptionInputSchema,
  RunsListInputSchema,
  RunsListOutputSchema,
} from "@agentic-chat/contracts"

import { createTrackedEventStream, TrackedEventStreamSchema } from "../events/stream.js"
import { mvpViewerProcedure, router } from "../trpc.js"

export const runsRouter = router({
  list: mvpViewerProcedure
    .input(RunsListInputSchema)
    .output(RunsListOutputSchema)
    .query(({ ctx, input }) => ctx.services.listRuns(input)),
  get: mvpViewerProcedure
    .input(RunGetInputSchema)
    .output(RunProjectionSchema)
    .query(({ ctx, input }) => ctx.services.run(ctx.actor.role, input)),
  events: mvpViewerProcedure
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
        include: () => true,
      }),
    ),
})
