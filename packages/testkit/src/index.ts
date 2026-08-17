export class MutableTestClock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current)
  }

  set(instant: Date): void {
    this.current = new Date(instant)
  }
}

export class AsyncBarrier {
  private arrivals = 0
  private release: (() => void) | undefined
  private readonly opened: Promise<void>

  constructor(private readonly participants: number) {
    if (!Number.isSafeInteger(participants) || participants < 1) {
      throw new RangeError("Barrier participants must be a positive safe integer")
    }
    this.opened = new Promise((resolve) => {
      this.release = resolve
    })
  }

  async wait(): Promise<void> {
    this.arrivals += 1
    if (this.arrivals === this.participants) {
      this.release?.()
      this.release = undefined
    }
    await this.opened
  }
}

class ControlledTestBarrier {
  private enter: (() => void) | undefined
  private open: (() => void) | undefined
  private readonly entered = new Promise<void>((resolve) => {
    this.enter = resolve
  })
  private readonly opened = new Promise<void>((resolve) => {
    this.open = resolve
  })

  constructor(held: boolean) {
    if (!held) this.release()
  }

  async arrive(): Promise<void> {
    this.enter?.()
    this.enter = undefined
    await this.opened
  }

  waitUntilEntered(): Promise<void> {
    return this.entered
  }

  release(): void {
    this.open?.()
    this.open = undefined
  }
}

export class ReportJobTestControls {
  private readonly acceptance: ControlledTestBarrier
  private readonly completion: ControlledTestBarrier
  private readonly completed = new ControlledTestBarrier(false)
  private crashPending: boolean

  constructor(
    options: {
      readonly pauseAfterAccept?: boolean
      readonly holdCompletion?: boolean
      readonly crashAfterProgressOnce?: boolean
      readonly duplicateDelivery?: boolean
    } = {},
  ) {
    this.acceptance = new ControlledTestBarrier(options.pauseAfterAccept === true)
    this.completion = new ControlledTestBarrier(options.holdCompletion === true)
    this.crashPending = options.crashAfterProgressOnce === true
    this.duplicateDelivery = options.duplicateDelivery === true
  }

  readonly duplicateDelivery: boolean

  afterAccepted(): Promise<void> {
    return this.acceptance.arrive()
  }

  waitUntilAccepted(): Promise<void> {
    return this.acceptance.waitUntilEntered()
  }

  releaseAcceptance(): void {
    this.acceptance.release()
  }

  beforeCompletion(): Promise<void> {
    return this.completion.arrive()
  }

  waitUntilCompletionHeld(): Promise<void> {
    return this.completion.waitUntilEntered()
  }

  releaseCompletion(): void {
    this.completion.release()
  }

  takeCrashAfterProgress(): boolean {
    const crash = this.crashPending
    this.crashPending = false
    return crash
  }

  afterCompleted(): Promise<void> {
    return this.completed.arrive()
  }

  waitUntilCompleted(): Promise<void> {
    return this.completed.waitUntilEntered()
  }
}

export * from "./acceptance.js"
export * from "./acceptance-observation.js"
export * from "./acceptance-types.js"
