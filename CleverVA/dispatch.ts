import type { Reminder } from "./db.ts";
import type { SlackSender } from "./slack.ts";
import type { GmailSender } from "./gmail.ts";

export type ReminderSend = (r: Reminder) => Promise<void>;

/** Routes a reminder to the correct channel sender. */
export function createReminderSender(senders: {
  slack: SlackSender;
  gmail: GmailSender;
}): ReminderSend {
  return async (r: Reminder): Promise<void> => {
    if (r.channel === "gmail") {
      if (!r.email) throw new Error(`gmail reminder ${r.id} has no email`);
      await senders.gmail(r.email, `Reminder: ${r.client_name}`, r.message);
      return;
    }
    if (!r.connection_id) throw new Error(`slack reminder ${r.id} has no connection_id`);
    await senders.slack(r.slack_target, r.message, r.connection_id);
  };
}