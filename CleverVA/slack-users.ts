import { createZapierSdk } from "@zapier/zapier-sdk";

export interface SlackUser {
  id: string;
  name: string;
  connectionId: string;
  workspace: string;
}

/** Filters raw Slack members down to real people. */
export function toPeople(rawMembers: any[], connectionId: string, workspace: string): SlackUser[] {
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
      connectionId,
      workspace,
    }));
}

/** Fetches people from every connected Slack workspace. */
export async function fetchSlackUsers(): Promise<SlackUser[]> {
  const zapier = createZapierSdk();

  const { data: connections } = await zapier.listConnections({
    appKey: "slack",
    owner: "me",
  });

  const active = (connections ?? []).filter((c: any) => !c.is_expired);
  if (active.length === 0) {
    throw new Error("No Slack connections found on this Zapier account");
  }

  const all: SlackUser[] = [];

  for (const connection of active) {
    try {
      const res: any = await zapier.runAction({
        app: "slack",
        actionType: "read",
        action: "users",
        connectionId: connection.id,
        inputs: {},
      });
      const members = Array.isArray(res?.data) ? res.data : [];
      all.push(...toPeople(members, connection.id, connection.title ?? "Slack"));
    } catch (err) {
      console.error(`Could not load users for connection ${connection.id}:`, err);
    }
  }

  return all.sort((a, b) => {
    const w = a.workspace.toLowerCase().localeCompare(b.workspace.toLowerCase());
    return w !== 0 ? w : a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

export type SlackUserCache = {
  get(forceRefresh?: boolean): Promise<SlackUser[]>;
};

/** Caches the people list for `ttlMs`. */
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