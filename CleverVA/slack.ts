/** Sends `text` to a Slack member id `target` as the VA's personal account. */
export type SlackSender = (target: string, text: string) => Promise<void>;

export const zapierSlackSender: SlackSender = async (target, text) => {
  const token = process.env.SLACK_USER_TOKEN;
  if (!token) throw new Error("SLACK_USER_TOKEN is not set");

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel: target, text }),
  });

  const body: any = await res.json();
  if (!body.ok) throw new Error(`Slack error: ${body.error}`);
};
