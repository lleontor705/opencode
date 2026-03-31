import { afterEach, describe, expect, test } from "bun:test"
import { MailboxHub, TeamMailbox } from "../../src/tool/team-mailbox"
import { TeamSendTool } from "../../src/tool/team-send"
import { TeamRecvTool } from "../../src/tool/team-recv"

function makeCtx(sessionID: string, abort?: AbortSignal): any {
  return {
    sessionID,
    messageID: "msg-1",
    agent: "test",
    abort: abort ?? new AbortController().signal,
    messages: [],
    metadata: () => {},
    ask: async () => {},
  }
}

describe("TeamSendTool", () => {
  afterEach(() => {
    TeamMailbox.unregister("child-a-session" as any)
    TeamMailbox.unregister("child-b-session" as any)
  })

  test("delivers message to target child", async () => {
    const hub = new MailboxHub()
    hub.registerChild("task_0")
    hub.registerChild("task_1")
    TeamMailbox.register("child-a-session" as any, hub, "task_0")
    TeamMailbox.register("child-b-session" as any, hub, "task_1")

    const tool = await TeamSendTool.init()
    const result = await tool.execute(
      { to: "task_1", message: "coordinate on API design" },
      makeCtx("child-a-session"),
    )

    expect(result.output).toContain('delivered to "task_1"')
    expect(result.metadata).toMatchObject({ from: "task_0", to: "task_1" })

    const messages = hub.recv("task_1")
    expect(messages).toHaveLength(1)
    expect(messages[0].body).toBe("coordinate on API design")
    expect(messages[0].from).toBe("task_0")

    hub.destroy()
  })

  test("errors when called outside team context", async () => {
    const tool = await TeamSendTool.init()
    const result = tool.execute(
      { to: "task_1", message: "hello" },
      makeCtx("not-a-team-session"),
    )
    await expect(result).rejects.toThrow("only available to agents spawned by the team tool")
  })

  test("errors when sending to self", async () => {
    const hub = new MailboxHub()
    hub.registerChild("task_0")
    TeamMailbox.register("child-a-session" as any, hub, "task_0")

    const tool = await TeamSendTool.init()
    const result = tool.execute(
      { to: "task_0", message: "hello me" },
      makeCtx("child-a-session"),
    )
    await expect(result).rejects.toThrow("Cannot send a message to yourself")

    hub.destroy()
  })

  test("errors when sending to unknown target", async () => {
    const hub = new MailboxHub()
    hub.registerChild("task_0")
    hub.registerChild("task_1")
    TeamMailbox.register("child-a-session" as any, hub, "task_0")

    const tool = await TeamSendTool.init()
    const result = tool.execute(
      { to: "task_99", message: "hello" },
      makeCtx("child-a-session"),
    )
    await expect(result).rejects.toThrow('Unknown target "task_99"')

    hub.destroy()
  })
})

describe("TeamRecvTool", () => {
  afterEach(() => {
    TeamMailbox.unregister("child-a-session" as any)
    TeamMailbox.unregister("child-b-session" as any)
  })

  test("receives pending messages", async () => {
    const hub = new MailboxHub()
    hub.registerChild("task_0")
    hub.registerChild("task_1")
    TeamMailbox.register("child-a-session" as any, hub, "task_0")
    TeamMailbox.register("child-b-session" as any, hub, "task_1")

    hub.send("task_0", "task_1", "please review")

    const tool = await TeamRecvTool.init()
    const result = await tool.execute({}, makeCtx("child-b-session"))

    expect(result.output).toContain("please review")
    expect(result.output).toContain('from="task_0"')
    expect(result.metadata).toMatchObject({ childID: "task_1", count: 1 })

    hub.destroy()
  })

  test("filters messages by sender", async () => {
    const hub = new MailboxHub()
    hub.registerChild("a")
    hub.registerChild("b")
    hub.registerChild("c")
    TeamMailbox.register("child-a-session" as any, hub, "c")

    hub.send("a", "c", "from a")
    hub.send("b", "c", "from b")

    const tool = await TeamRecvTool.init()
    const result = await tool.execute({ from: "a" }, makeCtx("child-a-session"))

    expect(result.output).toContain("from a")
    expect(result.output).not.toContain("from b")

    const result2 = await tool.execute({}, makeCtx("child-a-session"))
    expect(result2.output).toContain("from b")

    hub.destroy()
  })

  test("waits for messages with timeout", async () => {
    const hub = new MailboxHub()
    hub.registerChild("task_0")
    TeamMailbox.register("child-a-session" as any, hub, "task_0")

    const tool = await TeamRecvTool.init()
    const start = Date.now()
    const result = await tool.execute({ timeout_ms: 100 }, makeCtx("child-a-session"))
    const elapsed = Date.now() - start

    expect(elapsed).toBeGreaterThanOrEqual(90)
    expect(result.output).toContain("No messages received")
    expect(result.metadata).toMatchObject({ childID: "task_0", count: 0 })

    hub.destroy()
  })

  test("receives message that arrives during wait", async () => {
    const hub = new MailboxHub()
    hub.registerChild("task_0")
    hub.registerChild("task_1")
    TeamMailbox.register("child-a-session" as any, hub, "task_0")

    setTimeout(() => hub.send("task_1", "task_0", "late arrival"), 50)

    const tool = await TeamRecvTool.init()
    const result = await tool.execute({ timeout_ms: 5000 }, makeCtx("child-a-session"))

    expect(result.output).toContain("late arrival")
    expect(result.metadata.count).toBe(1)

    hub.destroy()
  })

  test("errors when called outside team context", async () => {
    const tool = await TeamRecvTool.init()
    const result = tool.execute({}, makeCtx("not-a-team-session"))
    await expect(result).rejects.toThrow("only available to agents spawned by the team tool")
  })

  test("respects abort signal during wait", async () => {
    const hub = new MailboxHub()
    hub.registerChild("task_0")
    TeamMailbox.register("child-a-session" as any, hub, "task_0")

    const controller = new AbortController()
    setTimeout(() => controller.abort(), 50)

    const tool = await TeamRecvTool.init()
    const start = Date.now()
    const result = await tool.execute(
      { timeout_ms: 30000 },
      makeCtx("child-a-session", controller.signal),
    )
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(5000)
    expect(result.output).toContain("No messages received")

    hub.destroy()
  })
})

describe("team_send + team_recv integration", () => {
  afterEach(() => {
    TeamMailbox.unregister("session-a" as any)
    TeamMailbox.unregister("session-b" as any)
    TeamMailbox.unregister("session-c" as any)
  })

  test("bidirectional A→B and B→A delivery", async () => {
    const hub = new MailboxHub()
    hub.registerChild("a")
    hub.registerChild("b")
    TeamMailbox.register("session-a" as any, hub, "a")
    TeamMailbox.register("session-b" as any, hub, "b")

    const send = await TeamSendTool.init()
    const recv = await TeamRecvTool.init()

    await send.execute({ to: "b", message: "A to B" }, makeCtx("session-a"))
    await send.execute({ to: "a", message: "B to A" }, makeCtx("session-b"))

    const bMessages = await recv.execute({}, makeCtx("session-b"))
    expect(bMessages.output).toContain("A to B")

    const aMessages = await recv.execute({}, makeCtx("session-a"))
    expect(aMessages.output).toContain("B to A")

    hub.destroy()
  })

  test("messaging failures do not affect collect-all behavior", async () => {
    const hub = new MailboxHub()
    hub.registerChild("task_0")
    hub.registerChild("task_1")
    TeamMailbox.register("session-a" as any, hub, "task_0")
    TeamMailbox.register("session-b" as any, hub, "task_1")

    const send = await TeamSendTool.init()
    await send.execute({ to: "task_1", message: "hello" }, makeCtx("session-a"))

    hub.destroy()
    TeamMailbox.unregisterAll(hub)

    const send2 = await TeamSendTool.init()
    const result = send2.execute(
      { to: "task_1", message: "after destroy" },
      makeCtx("session-a"),
    )
    await expect(result).rejects.toThrow("only available to agents spawned by the team tool")
  })

  test("concurrent team invocations are isolated", async () => {
    const hub1 = new MailboxHub()
    const hub2 = new MailboxHub()
    hub1.registerChild("worker")
    hub1.registerChild("helper")
    hub2.registerChild("worker")
    hub2.registerChild("helper")

    TeamMailbox.register("team1-worker" as any, hub1, "worker")
    TeamMailbox.register("team1-helper" as any, hub1, "helper")
    TeamMailbox.register("team2-worker" as any, hub2, "worker")
    TeamMailbox.register("team2-helper" as any, hub2, "helper")

    const send = await TeamSendTool.init()
    const recv = await TeamRecvTool.init()

    await send.execute({ to: "helper", message: "team1 msg" }, makeCtx("team1-worker"))
    await send.execute({ to: "helper", message: "team2 msg" }, makeCtx("team2-worker"))

    const team1Result = await recv.execute({}, makeCtx("team1-helper"))
    expect(team1Result.output).toContain("team1 msg")
    expect(team1Result.output).not.toContain("team2 msg")

    const team2Result = await recv.execute({}, makeCtx("team2-helper"))
    expect(team2Result.output).toContain("team2 msg")
    expect(team2Result.output).not.toContain("team1 msg")

    TeamMailbox.unregister("team1-worker" as any)
    TeamMailbox.unregister("team1-helper" as any)
    TeamMailbox.unregister("team2-worker" as any)
    TeamMailbox.unregister("team2-helper" as any)
    hub1.destroy()
    hub2.destroy()
  })
})
