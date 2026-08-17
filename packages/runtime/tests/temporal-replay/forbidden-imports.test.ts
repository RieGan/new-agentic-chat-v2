import { existsSync, readFileSync } from "node:fs"
import { dirname, extname, resolve } from "node:path"

import { describe, expect, it } from "vitest"

const forbiddenImports = [
  /^node:/,
  /^ai$/,
  /^@ai-sdk\//,
  /^@agentic-chat\/db$/,
  /^@agentic-chat\/tools$/,
  /^bullmq$/,
  /^ioredis$/,
  /^pg$/,
] as const

const sourcePath = (importer: string, specifier: string): string | null => {
  const unresolved = resolve(dirname(importer), specifier)
  const candidates = extname(unresolved)
    ? [unresolved.replace(/\.js$/, ".ts")]
    : [`${unresolved}.ts`, resolve(unresolved, "index.ts")]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

const workflowDependencyGraph = (entrypoint: string): ReadonlyMap<string, readonly string[]> => {
  const graph = new Map<string, readonly string[]>()
  const visit = (filePath: string): void => {
    if (graph.has(filePath)) return
    const source = readFileSync(filePath, "utf8")
    const imports = [
      ...source.matchAll(/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g),
    ]
      .map((match) => match[1])
      .filter((specifier): specifier is string => specifier !== undefined)
    graph.set(filePath, imports)
    for (const specifier of imports) {
      if (!specifier.startsWith(".")) continue
      const dependency = sourcePath(filePath, specifier)
      if (dependency) visit(dependency)
    }
  }
  visit(entrypoint)
  return graph
}

describe("Temporal workflow dependency graph", () => {
  it("contains only deterministic workflow-safe imports", () => {
    // Given: the actual source graph reachable from the Temporal workflow entrypoint.
    const entrypoint = resolve(import.meta.dirname, "../../src/state-workflow/workflows.ts")
    const graph = workflowDependencyGraph(entrypoint)

    // When: every direct and transitive source import is classified.
    const violations = [...graph].flatMap(([filePath, imports]) =>
      imports
        .filter((specifier) => forbiddenImports.some((pattern) => pattern.test(specifier)))
        .map((specifier) => `${filePath}:${specifier}`),
    )

    // Then: workflow execution cannot reach application or Node I/O clients.
    expect([...graph.keys()].map((filePath) => filePath.replace(`${process.cwd()}/`, ""))).toEqual(
      expect.arrayContaining([
        "src/state-workflow/workflows.ts",
        "src/state-workflow/state-machine.ts",
        "src/state-workflow/contracts.ts",
      ]),
    )
    expect(violations).toEqual([])
  })
})
