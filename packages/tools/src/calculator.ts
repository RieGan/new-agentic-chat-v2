import { DivisionByZeroError, InvalidSchemaError } from "@agentic-chat/contracts"

const MAX_EXPRESSION_LENGTH = 256
const MAX_PARENTHESES_DEPTH = 32
const MAX_TOKENS = 128

class ArithmeticParser {
  private position = 0
  private parenthesesDepth = 0
  private tokenCount = 0

  constructor(private readonly expression: string) {}

  parse(): number {
    if (this.expression.length > MAX_EXPRESSION_LENGTH) {
      throw new InvalidSchemaError(["expression: exceeds 256 characters"])
    }

    const value = this.parseSum()
    this.skipWhitespace()
    if (this.position !== this.expression.length) {
      throw new InvalidSchemaError([`expression: unexpected token at position ${this.position}`])
    }
    if (!Number.isFinite(value)) {
      throw new InvalidSchemaError(["expression: result must be finite"])
    }
    return value
  }

  private parseSum(): number {
    let value = this.parseProduct()
    while (true) {
      if (this.consume("+")) {
        value += this.parseProduct()
      } else if (this.consume("-")) {
        value -= this.parseProduct()
      } else {
        return value
      }
    }
  }

  private parseProduct(): number {
    let value = this.parseUnary()
    while (true) {
      if (this.consume("*")) {
        value *= this.parseUnary()
      } else if (this.consume("/")) {
        const divisor = this.parseUnary()
        if (divisor === 0) throw new DivisionByZeroError()
        value /= divisor
      } else {
        return value
      }
    }
  }

  private parseUnary(): number {
    let sign = 1
    while (true) {
      if (this.consume("+")) continue
      if (this.consume("-")) {
        sign *= -1
        continue
      }
      return sign * this.parsePrimary()
    }
  }

  private parsePrimary(): number {
    if (this.consume("(")) {
      this.parenthesesDepth += 1
      if (this.parenthesesDepth > MAX_PARENTHESES_DEPTH) {
        throw new InvalidSchemaError(["expression: parentheses nesting exceeds 32"])
      }
      const value = this.parseSum()
      if (!this.consume(")")) {
        throw new InvalidSchemaError([
          `expression: missing closing parenthesis at position ${this.position}`,
        ])
      }
      this.parenthesesDepth -= 1
      return value
    }

    this.skipWhitespace()
    const match = this.expression.slice(this.position).match(/^(?:\d+(?:\.\d*)?|\.\d+)/)
    const literal = match?.[0]
    if (literal === undefined) {
      throw new InvalidSchemaError([`expression: expected number at position ${this.position}`])
    }
    this.position += literal.length
    this.incrementTokens()
    const value = Number(literal)
    if (!Number.isFinite(value)) {
      throw new InvalidSchemaError(["expression: numeric literal must be finite"])
    }
    return value
  }

  private consume(token: string): boolean {
    this.skipWhitespace()
    if (!this.expression.startsWith(token, this.position)) return false
    this.position += token.length
    this.incrementTokens()
    return true
  }

  private skipWhitespace(): void {
    while (/\s/u.test(this.expression[this.position] ?? "")) this.position += 1
  }

  private incrementTokens(): void {
    this.tokenCount += 1
    if (this.tokenCount > MAX_TOKENS) {
      throw new InvalidSchemaError(["expression: token count exceeds 128"])
    }
  }
}

export const evaluateExpression = (expression: string): number =>
  new ArithmeticParser(expression).parse()
