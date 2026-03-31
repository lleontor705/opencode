import { Tool } from "./tool"
import DESCRIPTION from "./team-send.txt"
import z from "zod"
import { TeamMailbox } from "./team-mailbox"

const parameters = z.object({
  to: z.string().describe("The ID of the target child agent in this team"),
  message: z.string().describe("The message content to send"),
})

export const TeamSendTool = Tool.define("team_send", {
  description: DESCRIPTION,
  parameters,
  async execute(params: z.infer<typeof parameters>, ctx) {
    const entry = TeamMailbox.lookup(ctx.sessionID)
    if (!entry) {
      throw new Error(
        "team_send is only available to agents spawned by the team tool. You are not running inside a team invocation.",
      )
    }

    const { hub, childID } = entry

    if (params.to === childID) {
      throw new Error("Cannot send a message to yourself.")
    }

    if (!hub.hasChild(params.to)) {
      const known = [...hub.childIDs()].filter((id) => id !== childID)
      throw new Error(
        `Unknown target "${params.to}". Valid targets: ${known.join(", ")}`,
      )
    }

    hub.send(childID, params.to, params.message)

    return {
      title: `Sent message to ${params.to}`,
      metadata: { from: childID, to: params.to },
      output: `Message delivered to "${params.to}".`,
    }
  },
})
