import { createZapierSdk } from "@zapier/zapier-sdk";

// info@deborahbutler.me Gmail connection (override with GMAIL_CONNECTION_ID).
const DEFAULT_GMAIL_CONNECTION_ID = "<your-gmail-connection-id>";

/** Sends a plain-text email. Throws on failure. */
export type GmailSender = (to: string, subject: string, body: string) => Promise<void>;

/** Pure builder for the Zapier Gmail `message` action inputs. */
export function buildGmailInputs(to: string, subject: string, body: string) {
  return { to, subject, body, body_type: "plain" };
}

export const zapierGmailSender: GmailSender = async (to, subject, body) => {
  const zapier = createZapierSdk();
  const connectionId = process.env.GMAIL_CONNECTION_ID || DEFAULT_GMAIL_CONNECTION_ID;
  await zapier.runAction({
    app: "gmail",
    actionType: "write",
    action: "message",
    connectionId,
    inputs: buildGmailInputs(to, subject, body),
  });
};
