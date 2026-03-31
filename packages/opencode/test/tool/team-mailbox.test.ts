import { describe, expect, test } from "bun:test"
import { MailboxHub, TeamMailbox } from "../../src/tool/team-mailbox"

describe("MailboxHub", () => {
  test("sends and receives messages between children", () => {
    const hub = new MailboxHub()
    hub.registerChild("a")
    hub.registerChild("b")

    hub.send("a", "b", "hello from a")
    const messages = hub.recv("b")

    expect(messages).toHaveLength(1)
    expect(messages[0].from).toBe("a")
    expect(messages[0].to).toBe("b")
    expect(messages[0].body).toBe("hello from a")
    expect(messages[0].time).toBeGreaterThan(0)
  })

  test("recv consumes messages", () => {
    const hub = new MailboxHub()
    hub.registerChild("a")
    hub.registerChild("b")

    hub.send("a", "b", "msg1")
    hub.recv("b")
    const second = hub.recv("b")

    expect(second).toHaveLength(0)
  })

  test("filters messages by sender", () => {
    const hub = new MailboxHub()
    hub.registerChild("a")
    hub.registerChild("b")
    hub.registerChild("c")

    hub.send("a", "c", "from a")
    hub.send("b", "c", "from b")

    const fromA = hub.recv("c", "a")
    expect(fromA).toHaveLength(1)
    expect(fromA[0].body).toBe("from a")

    const remaining = hub.recv("c")
    expect(remaining).toHaveLength(1)
    expect(remaining[0].body).toBe("from b")
  })

  test("throws on send to unknown child", () => {
    const hub = new MailboxHub()
    hub.registerChild("a")

    expect(() => hub.send("a", "unknown", "hi")).toThrow('Unknown target child: "unknown"')
  })

  test("throws on send from unknown child", () => {
    const hub = new MailboxHub()
    hub.registerChild("b")

    expect(() => hub.send("unknown", "b", "hi")).toThrow('Unknown sender child: "unknown"')
  })

  test("recv returns empty for unknown child", () => {
    const hub = new MailboxHub()
    const messages = hub.recv("nonexistent")
    expect(messages).toHaveLength(0)
  })

  test("waitForMessage resolves immediately when messages exist", async () => {
    const hub = new MailboxHub()
    hub.registerChild("a")
    hub.registerChild("b")

    hub.send("a", "b", "already here")
    await hub.waitForMessage("b", 1000)
    const messages = hub.recv("b")
    expect(messages).toHaveLength(1)
  })

  test("waitForMessage resolves when message arrives", async () => {
    const hub = new MailboxHub()
    hub.registerChild("a")
    hub.registerChild("b")

    setTimeout(() => hub.send("a", "b", "delayed"), 50)
    await hub.waitForMessage("b", 5000)
    const messages = hub.recv("b")
    expect(messages).toHaveLength(1)
    expect(messages[0].body).toBe("delayed")
  })

  test("waitForMessage times out with no messages", async () => {
    const hub = new MailboxHub()
    hub.registerChild("a")

    const start = Date.now()
    await hub.waitForMessage("a", 100)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(90)

    const messages = hub.recv("a")
    expect(messages).toHaveLength(0)
  })

  test("waitForMessage respects abort signal", async () => {
    const hub = new MailboxHub()
    hub.registerChild("a")

    const controller = new AbortController()
    setTimeout(() => controller.abort(), 50)

    const start = Date.now()
    await hub.waitForMessage("a", 10000, controller.signal)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(5000)
  })

  test("destroy wakes all waiters and clears state", async () => {
    const hub = new MailboxHub()
    hub.registerChild("a")
    hub.registerChild("b")

    const waiter = hub.waitForMessage("a", 60000)
    hub.destroy()
    await waiter

    expect(hub.hasChild("a")).toBe(false)
    expect(hub.hasChild("b")).toBe(false)
  })

  test("multiple messages maintain order", () => {
    const hub = new MailboxHub()
    hub.registerChild("a")
    hub.registerChild("b")

    hub.send("a", "b", "first")
    hub.send("a", "b", "second")
    hub.send("a", "b", "third")

    const messages = hub.recv("b")
    expect(messages).toHaveLength(3)
    expect(messages[0].body).toBe("first")
    expect(messages[1].body).toBe("second")
    expect(messages[2].body).toBe("third")
  })

  test("hasChild returns correct values", () => {
    const hub = new MailboxHub()
    hub.registerChild("x")

    expect(hub.hasChild("x")).toBe(true)
    expect(hub.hasChild("y")).toBe(false)
  })

  test("childIDs returns all registered children", () => {
    const hub = new MailboxHub()
    hub.registerChild("a")
    hub.registerChild("b")
    hub.registerChild("c")

    const ids = hub.childIDs()
    expect(ids.size).toBe(3)
    expect(ids.has("a")).toBe(true)
    expect(ids.has("b")).toBe(true)
    expect(ids.has("c")).toBe(true)
  })
})

describe("TeamMailbox registry", () => {
  test("register and lookup", () => {
    const hub = new MailboxHub()
    const sessionID = "test-session-1" as any

    TeamMailbox.register(sessionID, hub, "task_0")
    const entry = TeamMailbox.lookup(sessionID)

    expect(entry).toBeDefined()
    expect(entry!.hub).toBe(hub)
    expect(entry!.childID).toBe("task_0")

    TeamMailbox.unregister(sessionID)
    expect(TeamMailbox.lookup(sessionID)).toBeUndefined()
  })

  test("unregisterAll removes all entries for a hub", () => {
    const hub1 = new MailboxHub()
    const hub2 = new MailboxHub()
    const s1 = "session-1" as any
    const s2 = "session-2" as any
    const s3 = "session-3" as any

    TeamMailbox.register(s1, hub1, "a")
    TeamMailbox.register(s2, hub1, "b")
    TeamMailbox.register(s3, hub2, "c")

    TeamMailbox.unregisterAll(hub1)

    expect(TeamMailbox.lookup(s1)).toBeUndefined()
    expect(TeamMailbox.lookup(s2)).toBeUndefined()
    expect(TeamMailbox.lookup(s3)).toBeDefined()

    TeamMailbox.unregisterAll(hub2)
  })

  test("isolation between concurrent team invocations", () => {
    const hub1 = new MailboxHub()
    const hub2 = new MailboxHub()
    hub1.registerChild("worker")
    hub2.registerChild("worker")

    hub1.send("worker", "worker", "hub1 msg")
    const hub2Messages = hub2.recv("worker")
    expect(hub2Messages).toHaveLength(0)

    const hub1Messages = hub1.recv("worker")
    expect(hub1Messages).toHaveLength(1)
    expect(hub1Messages[0].body).toBe("hub1 msg")

    hub1.destroy()
    hub2.destroy()
  })
})
