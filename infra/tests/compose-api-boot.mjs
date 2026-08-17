import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const entrypoint = readFileSync(new URL("../docker/service-entrypoint.sh", import.meta.url), "utf8")
const dockerfile = readFileSync(new URL("../docker/Dockerfile", import.meta.url), "utf8")
const compose = readFileSync(new URL("../../compose.yaml", import.meta.url), "utf8")

assert.doesNotMatch(entrypoint, /busybox httpd|scaffold_ready|infrastructure_scaffold/)
assert.match(
  entrypoint,
  /node --conditions=production --enable-source-maps \/workspace\/apps\/api\/dist\/compose-main\.js/,
)
assert.match(dockerfile, /@agentic-chat\/api build/)
assert.match(compose, /http:\/\/127\.0\.0\.1:3000\/healthz["\]]/)
assert.doesNotMatch(compose, /http:\/\/127\.0\.0\.1:3000\/healthz\//)
assert.doesNotMatch(compose, /--spider[^\n]*http:\/\/127\.0\.0\.1:3000\/healthz/)

console.log("Compose API boots the compiled application with canonical readiness")
