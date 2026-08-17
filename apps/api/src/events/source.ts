export interface RunEventSource {
  listen(runId: string, listener: () => void): Promise<() => void>
}

export const createPollingRunEventSource = (intervalMs = 250): RunEventSource => ({
  listen(_runId, listener) {
    const timer = setInterval(listener, intervalMs)
    timer.unref()
    return Promise.resolve(() => clearInterval(timer))
  },
})
