export interface MailboxMessage {
  readonly from: string
  readonly to: string
  readonly body: string
  readonly time: number
}

export class MailboxHub {
  readonly #children = new Set<string>()
  readonly #queues = new Map<string, MailboxMessage[]>()
  readonly #waiters = new Map<string, Array<() => void>>()

  registerChild(childID: string): void {
    this.#children.add(childID)
    this.#queues.set(childID, [])
  }

  hasChild(childID: string): boolean {
    return this.#children.has(childID)
  }

  childIDs(): ReadonlySet<string> {
    return this.#children
  }

  send(from: string, to: string, body: string): void {
    if (!this.#children.has(to)) throw new Error(`Unknown target child: "${to}"`)
    if (!this.#children.has(from)) throw new Error(`Unknown sender child: "${from}"`)
    const queue = this.#queues.get(to)!
    queue.push({ from, to, body, time: Date.now() })
    const waiters = this.#waiters.get(to)
    if (waiters) {
      for (const wake of waiters) wake()
      this.#waiters.set(to, [])
    }
  }

  recv(childID: string, from?: string): MailboxMessage[] {
    const queue = this.#queues.get(childID)
    if (!queue) return []
    if (from) {
      const matching: MailboxMessage[] = []
      const remaining: MailboxMessage[] = []
      for (const msg of queue) {
        if (msg.from === from) matching.push(msg)
        else remaining.push(msg)
      }
      this.#queues.set(childID, remaining)
      return matching
    }
    const all = [...queue]
    queue.length = 0
    return all
  }

  waitForMessage(childID: string, timeoutMs: number, abort?: AbortSignal): Promise<void> {
    const queue = this.#queues.get(childID)
    if (queue && queue.length > 0) return Promise.resolve()

    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs)
      const wake = () => {
        clearTimeout(timer)
        resolve()
      }

      const existing = this.#waiters.get(childID) ?? []
      existing.push(wake)
      this.#waiters.set(childID, existing)

      abort?.addEventListener("abort", wake, { once: true })
    })
  }

  destroy(): void {
    this.#children.clear()
    this.#queues.clear()
    for (const waiters of this.#waiters.values()) {
      for (const wake of waiters) wake()
    }
    this.#waiters.clear()
  }
}

// Global registry: maps child session IDs to their mailbox hub + identity
const sessionRegistry = new Map<
  string,
  { hub: MailboxHub; childID: string }
>()

export namespace TeamMailbox {
  export function register(sessionID: string, hub: MailboxHub, childID: string): void {
    sessionRegistry.set(sessionID, { hub, childID })
  }

  export function unregister(sessionID: string): void {
    sessionRegistry.delete(sessionID)
  }

  export function lookup(sessionID: string): { hub: MailboxHub; childID: string } | undefined {
    return sessionRegistry.get(sessionID)
  }

  export function unregisterAll(hub: MailboxHub): void {
    for (const [key, entry] of sessionRegistry) {
      if (entry.hub === hub) sessionRegistry.delete(key)
    }
  }
}
