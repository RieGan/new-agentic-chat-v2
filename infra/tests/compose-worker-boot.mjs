import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const entrypoint = readFileSync(new URL("../docker/service-entrypoint.sh", import.meta.url), "utf8")
const dockerfile = readFileSync(new URL("../docker/Dockerfile", import.meta.url), "utf8")
const worker = readFileSync(
  new URL("../../packages/runtime/src/compose-worker.ts", import.meta.url),
  "utf8",
)

assert.doesNotMatch(entrypoint, /sleep infinity/)
assert.doesNotMatch(entrypoint, /--max-old-space-size=48/)
assert.match(entrypoint, /packages\/runtime\/dist\/compose-worker\.js/)
assert.match(
  entrypoint,
  /exec node --max-old-space-size=128 --conditions=production --enable-source-maps \/workspace\/packages\/runtime\/dist\/compose-worker\.js "\$worker_role"/,
)
assert.match(dockerfile, /@agentic-chat\/runtime build/)
assert.match(worker, /NODE_ENV:\s*z\.literal\("test"\)/)

console.log("Compose workers boot the real runtime entrypoint")
