import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const entrypoint = readFileSync(new URL("../docker/service-entrypoint.sh", import.meta.url), "utf8")
const dockerfile = readFileSync(new URL("../docker/Dockerfile", import.meta.url), "utf8")
const worker = readFileSync(
  new URL("../../packages/runtime/src/compose-worker.ts", import.meta.url),
  "utf8",
)

assert.doesNotMatch(entrypoint, /sleep infinity/)
assert.match(entrypoint, /packages\/runtime\/dist\/compose-worker\.js/)
assert.match(dockerfile, /@agentic-chat\/runtime build/)
assert.match(worker, /NODE_ENV:\s*z\.literal\("test"\)/)

console.log("Compose workers boot the real runtime entrypoint")
