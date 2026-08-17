import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const rules = readFileSync(new URL("../../.dockerignore", import.meta.url), "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))

assert.ok(rules.includes(".env"), "Docker context must exclude .env")
assert.ok(rules.includes(".env.*"), "Docker context must exclude environment variants")
assert.ok(rules.includes("!.env.example"), "Docker context must retain .env.example")

const isIgnored = (path) => {
  let ignored = false
  for (const rule of rules) {
    const negated = rule.startsWith("!")
    const pattern = negated ? rule.slice(1) : rule
    const matches =
      pattern === ".env"
        ? path === ".env"
        : pattern === ".env.*"
          ? path.startsWith(".env.")
          : pattern === ".env.example"
            ? path === ".env.example"
            : false
    if (matches) ignored = !negated
  }
  return ignored
}

assert.equal(isIgnored(".env"), true)
assert.equal(isIgnored(".env.local"), true)
assert.equal(isIgnored(".env.example"), false)

console.log("Docker context excludes local environment files and retains .env.example")
