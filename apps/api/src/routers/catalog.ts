import {
  JobEnvelopeSchema,
  JobGetInputSchema,
  SkillGetInputSchema,
  SkillSnapshotSchema,
} from "@agentic-chat/contracts"

import { mvpUserProcedure, router } from "../trpc.js"

export const jobsRouter = router({
  get: mvpUserProcedure
    .input(JobGetInputSchema)
    .output(JobEnvelopeSchema)
    .query(({ ctx, input }) => ctx.services.job(input)),
})

export const skillsRouter = router({
  get: mvpUserProcedure
    .input(SkillGetInputSchema)
    .output(SkillSnapshotSchema)
    .query(({ ctx, input }) => ctx.services.skill(input)),
})
