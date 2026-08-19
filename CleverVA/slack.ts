import { createZapierSdk } from "@zapier/zapier-sdk";

/** Sends `text` to Slack member `target` via the given connection. */
export type SlackSender = (target: string, text: string, connectionId: string) => Promise<void>;

export const zapierSlackSender: SlackSender = async (target, text, connectionId) => {
  if (!connectionId) throw new Error("No Slack connection id on this reminder");

  const zapier = createZapierSdk();

  await zapier.runAction({
    app: "slack",
    actionType: "write",
    action: "direct_message",
    connectionId,
    inputs: { channel: target, text },
  });
};