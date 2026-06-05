import { createZapierSdk } from "@zapier/zapier-sdk";

// Reused from slack.ts / src/zapier-slack-test.ts
const CONNECTION_ID = "02687b2e-345c-860b-9d27-533f33afee39";

export interface SlackUser {
  id: string;
  name: string;
}

/** Filters raw Slack members down to real people and maps them to {id, name}, sorted by name. */
export function toPeople(rawMembers: any[]): SlackUser[] {
  return rawMembers
    .filter(
      (m) =>
        m &&
        !m.deleted &&
        !m.is_bot &&
        !m.is_app_user &&
        m.id !== "USLACKBOT",
    )
    .map((m) => ({
      id: m.id,
      name: m.real_name || m.profile?.display_name || m.name || m.id,
    }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/** Fetches the workspace's people via the Zapier Slack `users` read action. */
export async function fetchSlackUsers(): Promise<SlackUser[]> {
  const zapier = createZapierSdk();
  const res: any = await zapier.runAction({
    app: "slack",
    actionType: "read",
    action: "users",
    connectionId: CONNECTION_ID,
    inputs: {},
  });
  const members = Array.isArray(res?.data) ? res.data : [];
  return toPeople(members);
}

export type SlackUserCache = {
  get(forceRefresh?: boolean): Promise<SlackUser[]>;
};

/** Caches the people list for `ttlMs`. `now` is injectable for deterministic tests. */
export function createSlackUserCache(
  fetcher: () => Promise<SlackUser[]>,
  ttlMs = 600_000,
  now: () => number = () => Date.now(),
): SlackUserCache {
  let cached: SlackUser[] | null = null;
  let fetchedAt = 0;
  let inflight: Promise<SlackUser[]> | null = null;

  return {
    async get(forceRefresh = false): Promise<SlackUser[]> {
      const stale = cached === null || now() - fetchedAt >= ttlMs;
      if (forceRefresh || stale) {
        if (!inflight) {
          inflight = fetcher().then((result) => {
            cached = result;
            fetchedAt = now();
            inflight = null;
            return result;
          });
        }
        return inflight;
      }
      return cached!;
    },
  };
}
