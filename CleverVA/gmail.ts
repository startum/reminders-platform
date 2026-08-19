import { createZapierSdk } from "@zapier/zapier-sdk";

/** Sends a plain-text email. Throws on failure. */
export type GmailSender = (to: string, subject: string, body: string) => Promise<void>;

/** Pure builder for the Zapier Gmail `message` action inputs. */
export function buildGmailInputs(to: string, subject: string, body: string) {
  return { to, subject, body, body_type: "plain" };
}

export const zapierGmailSender: GmailSender = async (to, subject, body) => {
  const zapier = createZapierSdk();

  const { data: connection } = await zapier.findFirstConnection({
    appKey: "gmail",
    owner: "me",
    isExpired: false,
  });

  if (!connection) {
    throw new Error("No Gmail connection found on this Zapier account");
  }

  await zapier.runAction({
    app: "gmail",
    actionType: "write",
    action: "message",
    connectionId: connection.id,
    inputs: buildGmailInputs(to, subject, body),
  });
};