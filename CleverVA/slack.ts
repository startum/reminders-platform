import { createZapierSdk } from "@zapier/zapier-sdk";

// Reused from src/zapier-slack-test.ts
const CONNECTION_ID = "02687b2e-345c-860b-9d27-533f33afee39";

/** Sends `text` to a Slack member id `target`. Throws on failure. */
export type SlackSender = (target: string, text: string) => Promise<void>;

export const zapierSlackSender: SlackSender = async (target, text) => {
  const zapier = createZapierSdk();
  await zapier.runAction({
    app: "slack",
    actionType: "write",
    action: "direct_message",
    connectionId: CONNECTION_ID,
    inputs: { channel: target, text },
  });
};
