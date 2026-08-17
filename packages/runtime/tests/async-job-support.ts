import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { promisify } from "node:util"

const execute = promisify(execFile)

export type RedisTestContext = {
  readonly containerName: string
  readonly redisUrl: string
  readonly port: number
}

export const startRedisTestContext = async (): Promise<RedisTestContext> => {
  const containerName = `agentic-chat-redis-test-${randomUUID()}`
  await execute("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    containerName,
    "--publish",
    "127.0.0.1::6379",
    "--health-cmd",
    "redis-cli ping",
    "--health-interval",
    "250ms",
    "--health-timeout",
    "2s",
    "--health-retries",
    "80",
    "redis:8.2-alpine",
  ])
  const portOutput = await execute("docker", ["port", containerName, "6379/tcp"])
  const port = Number(portOutput.stdout.trim().split(":").at(-1))
  if (!Number.isSafeInteger(port)) {
    throw new TypeError(`Docker returned an invalid Redis port: ${portOutput.stdout}`)
  }
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const health = await execute("docker", [
      "inspect",
      "--format",
      "{{.State.Health.Status}}",
      containerName,
    ])
    if (health.stdout.trim() === "healthy") {
      return { containerName, redisUrl: `redis://127.0.0.1:${port}`, port }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  await execute("docker", ["rm", "--force", "--volumes", containerName])
  throw new Error(`Redis container ${containerName} did not become healthy`)
}

export const stopRedisTestContext = async (context: RedisTestContext): Promise<void> => {
  await execute("docker", ["rm", "--force", "--volumes", context.containerName])
}
