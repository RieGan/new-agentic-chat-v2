import { EnvironmentConfigError, parseEnvironment } from "./environment.js"

try {
  parseEnvironment(process.env)
} catch (error) {
  if (error instanceof EnvironmentConfigError) {
    process.stderr.write(`${error.name}: ${error.message}\n`)
    process.exitCode = 1
  } else {
    throw error
  }
}
