import { Tool } from "./tool"
import DESCRIPTION from "./team-recv.txt"
import z from "zod"
import { TeamMailbox } from "./team-mailbox"

const MAX_TIMEOUT_MS = 30_000
const DEFAULT_TIMEOUT_MS = 5_000

const parameters = z.object({
  from: z
    .string()
    .optional()
    .describe("Optional sender ID to filter messages. If omitted, returns all pending messages."),
  timeout_ms: z
    .number()
    .int()
    .positive()
    .max(MAX_TIMEOUT_MS)
    .optional()
    .describe("Wait time in milliseconds for new messages (default: 5000, max: 30000)"),
})

export const TeamRecvTool = Tool.define("team_recv", {
  description: DESCRIPTION,
  parameters,
  async execute(params: z.infer<typeof parameters>, ctx) {
    const entry = TeamMailbox.lookup(ctx.sessionID)
    if (!entry) {
      throw new Error(
        "team_recv is only available to agents spawned by the team tool. You are not running inside a team invocation.",
      )
    }

    const { hub, childID } = entry
    const timeout = Math.min(params.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)

    // Check for existing messages first
    const existing = hub.recv(childID, params.from)
    if (existing.length > 0) {
      return {
        title: `Received ${existing.length} message(s)`,
        metadata: { childID, count: existing.length },
        output: formatMessages(existing),
      }
    }

    // Wait for new messages
    await hub.waitForMessage(childID, timeout, ctx.abort)

    const messages = hub.recv(childID, params.from)
    if (messages.length === 0) {
      return {
        title: "No messages",
        metadata: { childID, count: 0 },
        output: `No messages received after waiting ${timeout}ms.`,
      }
    }

    return {
      title: `Received ${messages.length} message(s)`,
      metadata: { childID, count: messages.length },
      output: formatMessages(messages),
    }
  },
})

function formatMessages(messages: Array<{ from: string; body: string; time: number }>): string {
  return messages
    .map((msg) => `<message from="${msg.from}" time="${msg.time}">\n${msg.body}\n</message>`)
    .join("\n")
}
