import { createZapierSdk } from "@zapier/zapier-sdk";

/** Sends `text` to a Slack member id `target`. */
export type SlackSender = (target: string, text: string) => Promise<void>;

export const zapierSlackSender: SlackSender = async (target, text) => {
  const zapier = createZapierSdk();

  const { data: connection } = await zapier.findFirstConnection({
    appKey: "slack",
    owner: "me",
    isExpired: false,
  });

  if (!connection) {
    throw new Error("No Slack connection found on this Zapier account");
  }

  await zapier.runAction({
    app: "slack",
    actionType: "write",
    action: "direct_message",
    connectionId: connection.id,
    inputs: { channel: target, text },
  });
};