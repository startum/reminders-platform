import { createZapierSdk } from "@zapier/zapier-sdk";

const zapier = createZapierSdk();
const CONNECTION_ID = "02687b2e-345c-860b-9d27-533f33afee39";
const SLACK_USER_ID = "UTC7M3UG3"; // Debs

async function main() {
  console.log(`Sending DM to Debs (${SLACK_USER_ID})...`);
  const { data: dmResult } = await zapier.runAction({
    app: "slack",
    actionType: "write",
    action: "direct_message",
    connectionId: CONNECTION_ID,
    inputs: {
      channel: SLACK_USER_ID,
      text: "Hello via Zapier SDK 👋",
    },
  });

  console.log("DM result:", JSON.stringify(dmResult, null, 2));
  console.log("Done!");
}

main().catch(console.error);
