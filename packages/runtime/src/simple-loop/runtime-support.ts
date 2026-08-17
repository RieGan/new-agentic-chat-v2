import {
  type ContractErrorData,
  InvalidSchemaError,
  type SkillSnapshot,
  SkillSnapshotSchema,
  ToolNotAllowedError,
} from "@agentic-chat/contracts"
import type { readSimpleLoopRun } from "@agentic-chat/db"
import { InvalidToolInputError, NoSuchToolError } from "ai"
import { z } from "zod"

import { type SimpleLoopContext, SimpleLoopContextSchema } from "./context.js"
import { toContractError } from "./errors.js"
import { ProviderBoundaryFailure } from "./provider-model.js"
import type { MutableLoopState } from "./tools.js"

export const typedContext = (state: MutableLoopState): SimpleLoopContext =>
  SimpleLoopContextSchema.parse({
    kind: "simple_loop",
    consumedSteps: state.consumedSteps,
    messages: state.messages,
    ...(state.selectedSkill === undefined ? {} : { selectedSkill: state.selectedSkill }),
    ...(state.wait === undefined ? {} : { wait: state.wait }),
    ...(state.guidanceCommandId === undefined
      ? {}
      : { guidanceCommandId: state.guidanceCommandId }),
  })

export const contextValue = (state: MutableLoopState) => z.json().parse(typedContext(state))

export const selectedSkillFromRun = (
  run: NonNullable<Awaited<ReturnType<typeof readSimpleLoopRun>>>,
) =>
  run.skillId === null ||
  run.skillVersion === null ||
  run.instructions === null ||
  run.allowedTools === null
    ? undefined
    : SkillSnapshotSchema.parse({
        skillId: run.skillId,
        version: run.skillVersion,
        instructions: run.instructions,
        allowedTools: run.allowedTools,
      })

export const mapAgentFailure = (
  caught: unknown,
  selectedSkill: SkillSnapshot | undefined,
): { readonly error: ContractErrorData; readonly toolName?: string } => {
  if (caught instanceof ProviderBoundaryFailure) {
    const toolName =
      caught.result.error.toolName ??
      (selectedSkill?.allowedTools.length === 1 ? selectedSkill.allowedTools[0] : undefined)
    if (
      toolName !== undefined &&
      toolName !== "skill.load" &&
      selectedSkill !== undefined &&
      !selectedSkill.allowedTools.some((allowed) => allowed === toolName)
    ) {
      return {
        error: toContractError(
          new ToolNotAllowedError(`${selectedSkill.skillId}@${selectedSkill.version}`, toolName),
        ),
        toolName,
      }
    }
    return {
      error: toContractError(new InvalidSchemaError(["provider: invalid response"])),
      ...(toolName === undefined ? {} : { toolName }),
    }
  }
  if (InvalidToolInputError.isInstance(caught)) {
    return {
      error: toContractError(new InvalidSchemaError([`tool ${caught.toolName}: invalid input`])),
      toolName: caught.toolName,
    }
  }
  if (NoSuchToolError.isInstance(caught)) {
    return {
      error:
        selectedSkill === undefined
          ? toContractError(new InvalidSchemaError(["tool: unavailable before skill load"]))
          : toContractError(
              new ToolNotAllowedError(
                `${selectedSkill.skillId}@${selectedSkill.version}`,
                caught.toolName,
              ),
            ),
      toolName: caught.toolName,
    }
  }
  return { error: toContractError(caught) }
}
