# Slack User Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the typed Slack member-ID field with a dropdown of real Slack people, sourced live from the Zapier Slack `users` action and cached server-side.

**Architecture:** A new `slack-users.ts` module fetches+filters the workspace's members (people only) and caches them with a TTL; `server.ts` exposes them at `GET /api/slack-users`; the form's text input becomes a `<select>` populated from that endpoint with a manual refresh. The selected member ID flows through the unchanged POST → DB → scheduler → Slack path.

**Tech Stack:** TypeScript, tsx (`node:test`), Express 5, `@zapier/zapier-sdk`.

**Notes:**
- Work from repo root `/Users/deborahbutler/Documents/Zapier`. Run app source under `CleverVA/`.
- Local imports use explicit `.ts` extensions (tsx runner). Tests: `npx tsx --test CleverVA/<file>.test.ts`; full suite: `npm test`.
- Confirmed live: `runAction({app:"slack", actionType:"read", action:"users", connectionId, inputs:{}})` returns an array of member objects with `id, name, real_name, is_bot, is_app_user, deleted, profile.display_name`. The proven `CONNECTION_ID` is `02687b2e-345c-860b-9d27-533f33afee39` (already in `slack.ts`).
- git repo on `master`. End commit messages with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Slack people directory + cache (`slack-users.ts`)

**Files:**
- Create: `CleverVA/slack-users.ts`
- Test: `CleverVA/slack-users.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `CleverVA/slack-users.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { toPeople, createSlackUserCache } from "./slack-users.ts";

const RAW = [
  { id: "USLACKBOT", name: "slackbot", real_name: "Slackbot", is_bot: false, is_app_user: false, deleted: false },
  { id: "UAPP1", name: "zoom", real_name: "Zoom", is_bot: false, is_app_user: true, deleted: false },
  { id: "UBOT1", name: "bot", real_name: "A Bot", is_bot: true, is_app_user: false, deleted: false },
  { id: "UDEL1", name: "gone", real_name: "Gone Person", is_bot: false, is_app_user: false, deleted: true },
  { id: "UTC7M3UG3", name: "debs", real_name: "Debs", is_bot: false, is_app_user: false, deleted: false },
  { id: "UJO1", name: "jo", real_name: "", is_bot: false, is_app_user: false, deleted: false, profile: { display_name: "Jo" } },
  { id: "UANN", name: "ann", real_name: "ann lower", is_bot: false, is_app_user: false, deleted: false },
];

test("toPeople keeps only real people, mapped to {id,name}", () => {
  const people = toPeople(RAW);
  assert.deepEqual(people.map((p) => p.id), ["UANN", "UTC7M3UG3", "UJO1"]);
});

test("toPeople names use real_name, then display_name, then name", () => {
  const people = toPeople(RAW);
  const jo = people.find((p) => p.id === "UJO1");
  const debs = people.find((p) => p.id === "UTC7M3UG3");
  assert.equal(jo.name, "Jo");        // falls back to profile.display_name
  assert.equal(debs.name, "Debs");    // real_name
});

test("toPeople sorts by name case-insensitively", () => {
  const people = toPeople(RAW);
  assert.deepEqual(people.map((p) => p.name), ["ann lower", "Debs", "Jo"]);
});

test("toPeople handles an empty array", () => {
  assert.deepEqual(toPeople([]), []);
});

test("cache fetches once and serves cached within TTL", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return [{ id: "U1", name: "One" }]; };
  let clock = 1000;
  const cache = createSlackUserCache(fetcher, 10_000, () => clock);

  const a = await cache.get();
  const b = await cache.get();
  assert.equal(calls, 1);
  assert.deepEqual(b, [{ id: "U1", name: "One" }]);
  assert.equal(a, b); // same cached array reference
});

test("cache refetches when forced", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return [{ id: "U" + calls, name: "N" + calls }]; };
  const cache = createSlackUserCache(fetcher, 10_000, () => 1000);

  await cache.get();
  const forced = await cache.get(true);
  assert.equal(calls, 2);
  assert.deepEqual(forced, [{ id: "U2", name: "N2" }]);
});

test("cache refetches after the TTL elapses", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return [{ id: "U" + calls, name: "N" + calls }]; };
  let clock = 1000;
  const cache = createSlackUserCache(fetcher, 10_000, () => clock);

  await cache.get();          // calls = 1 at t=1000
  clock = 1000 + 10_000;      // exactly TTL later -> stale
  await cache.get();          // calls = 2
  assert.equal(calls, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test CleverVA/slack-users.test.ts`
Expected: FAIL — cannot find module `./slack-users.ts`.

- [ ] **Step 3: Implement `CleverVA/slack-users.ts`**

```ts
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

  return {
    async get(forceRefresh = false): Promise<SlackUser[]> {
      const stale = cached === null || now() - fetchedAt >= ttlMs;
      if (forceRefresh || stale) {
        cached = await fetcher();
        fetchedAt = now();
      }
      return cached;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test CleverVA/slack-users.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add CleverVA/slack-users.ts CleverVA/slack-users.test.ts
git commit -m "feat: Slack people directory with cache"
```

---

### Task 2: Serve the people list + wire entry point (`server.ts`, `index.ts`)

**Files:**
- Modify: `CleverVA/server.ts`
- Modify: `CleverVA/server.test.ts`
- Modify: `CleverVA/index.ts`

- [ ] **Step 1: Update the failing tests**

In `CleverVA/server.test.ts`, the `createServer` call gains a second argument (a `SlackUserCache`). Update the import and the `withServer` helper, and add two new tests.

Change the import line at the top to also import the cache type indirectly via a fake — no type import needed in JS-style tests. Update `withServer` so it accepts an optional cache and passes it through:

```ts
function makeFakeCache(people = [{ id: "U1", name: "One" }]) {
  const calls: boolean[] = [];
  return {
    calls,
    get: async (force = false) => {
      calls.push(force);
      return people;
    },
  };
}

async function withServer(
  fn: (base: string, cache: ReturnType<typeof makeFakeCache>) => Promise<void>,
) {
  const db = openDb(":memory:");
  const cache = makeFakeCache();
  const server = createServer(db, cache).listen(0);
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`, cache);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
}
```

Then add these two tests at the end of the file:

```ts
test("GET /api/slack-users returns the cached people list", async () => {
  await withServer(async (base) => {
    const people = await (await fetch(`${base}/api/slack-users`)).json();
    assert.deepEqual(people, [{ id: "U1", name: "One" }]);
  });
});

test("GET /api/slack-users?refresh=1 forces a refresh", async () => {
  await withServer(async (base, cache) => {
    await fetch(`${base}/api/slack-users`);
    await fetch(`${base}/api/slack-users?refresh=1`);
    assert.deepEqual(cache.calls, [false, true]);
  });
});
```

NOTE: every existing `withServer(async (base) => {...})` callback keeps working — the new `cache` param is just ignored where unused.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test CleverVA/server.test.ts`
Expected: FAIL — `createServer` now needs a second arg / new tests fail (route not implemented).

- [ ] **Step 3: Implement the route in `server.ts`**

Add the import at the top of `CleverVA/server.ts`:
```ts
import type { SlackUserCache } from "./slack-users.ts";
```

Change the function signature:
```ts
export function createServer(db: Store, slackUsers: SlackUserCache) {
```

Add this route inside `createServer`, after the `GET /api/reminders` route and before `DELETE`:
```ts
  app.get("/api/slack-users", async (req, res) => {
    try {
      const people = await slackUsers.get(req.query.refresh === "1");
      res.json(people);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `Could not load Slack people: ${message}` });
    }
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test CleverVA/server.test.ts`
Expected: PASS — 8 tests (6 existing + 2 new).

- [ ] **Step 5: Wire the real cache in `index.ts`**

Replace the contents of `CleverVA/index.ts` with:
```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.ts";
import { createServer } from "./server.ts";
import { startScheduler } from "./scheduler.ts";
import { zapierSlackSender } from "./slack.ts";
import { createSlackUserCache, fetchSlackUsers } from "./slack-users.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4321);

const db = openDb(path.join(here, "reminders.db"));
const slackUsers = createSlackUserCache(fetchSlackUsers);
const app = createServer(db, slackUsers);
startScheduler(db, zapierSlackSender);

app.listen(PORT, () => {
  console.log(`Clever VA Reminders running at http://localhost:${PORT}`);
});
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — all suites green (7 db + 3 scheduler + 8 server + 7 slack-users = 25).

- [ ] **Step 7: Commit**

```bash
git add CleverVA/server.ts CleverVA/server.test.ts CleverVA/index.ts
git commit -m "feat: GET /api/slack-users endpoint wired with cache"
```

---

### Task 3: Dropdown in the form (`public/`)

**Files:**
- Modify: `CleverVA/public/index.html`
- Modify: `CleverVA/public/app.js`
- Modify: `CleverVA/public/styles.css`

(Verified manually in Task 4. No automated test.)

- [ ] **Step 1: Replace the Slack-target input in `index.html`**

In `CleverVA/public/index.html`, replace this line:
```html
        <label>Slack target (member ID) <input name="slack_target" placeholder="U0123456789" required /></label>
```
with:
```html
        <label>Slack person
          <select name="slack_target" id="slack-target" required>
            <option value="">Loading people…</option>
          </select>
        </label>
        <button type="button" id="refresh-people" class="linkish">↻ Refresh people</button>
```

- [ ] **Step 2: Add dropdown loading to `app.js`**

In `CleverVA/public/app.js`, add these functions immediately above the existing `const form = document.getElementById("reminder-form");` line:
```js
const slackTarget = document.getElementById("slack-target");

async function loadPeople(force = false) {
  slackTarget.innerHTML = `<option value="">Loading people…</option>`;
  try {
    const res = await fetch(`/api/slack-users${force ? "?refresh=1" : ""}`);
    if (!res.ok) throw new Error("request failed");
    const people = await res.json();
    if (!people.length) {
      slackTarget.innerHTML = `<option value="">No people found — try Refresh</option>`;
      return;
    }
    slackTarget.innerHTML =
      `<option value="" disabled selected>Select a person…</option>` +
      people.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
  } catch {
    slackTarget.innerHTML = `<option value="">Couldn't load people — try Refresh</option>`;
  }
}

document.getElementById("refresh-people").addEventListener("click", () => loadPeople(true));
```

Then add a call to `loadPeople()` next to the existing initial `show("add");` line at the very bottom of the file — change:
```js
show("add");
```
to:
```js
show("add");
loadPeople();
```

(The `esc` helper already exists in `app.js`; the submit handler is unchanged — it still reads `slack_target` from the form, now the `<select>` value.)

- [ ] **Step 3: Style the select + refresh link in `styles.css`**

Append to `CleverVA/public/styles.css`:
```css
select { background: var(--panel); border: 1px solid #30363d; border-radius: 6px; color: var(--text); padding: 10px; font: inherit; }
.linkish { background: none; border: none; color: var(--accent); font-size: 13px; padding: 0; cursor: pointer; align-self: flex-start; }
```

- [ ] **Step 4: Syntax-check app.js**

Run: `node --check CleverVA/public/app.js`
Expected: no output (valid).

- [ ] **Step 5: Commit**

```bash
git add CleverVA/public
git commit -m "feat: Slack person dropdown with refresh in Add Reminder form"
```

---

### Task 4: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — 25 tests across 4 suites, clean exit.

- [ ] **Step 2: Boot and verify the live dropdown (read-only — no Slack DM sent)**

Start the server on a test port:
```bash
PORT=4399 npx tsx CleverVA/index.ts &
```
Wait ~2s for the running message, then:
- `curl -s http://localhost:4399/api/slack-users | head -c 400` — confirm it returns a JSON array of `{id,name}` real people (e.g. contains "Debs"), and that it does NOT contain `"Slackbot"`, `"deactivateduser"`, `"zoom"`, or `"Google Drive"`.
- `curl -s 'http://localhost:4399/api/slack-users?refresh=1' | head -c 120` — confirm it still returns the array (forced refresh path works).
- `curl -s http://localhost:4399/ | grep -c 'id="slack-target"'` — confirm the dashboard HTML now contains the dropdown.

Do NOT POST a reminder with a near/past time (that would send a real Slack DM). Then kill the server (`kill %1` or by PID) and delete the smoke db: `rm -f CleverVA/reminders.db CleverVA/reminders.db-wal CleverVA/reminders.db-shm`.

- [ ] **Step 3: Report results**

Confirm: full suite green; `/api/slack-users` returns filtered people; refresh path works; dropdown present in HTML; no DM sent; smoke db removed.

---

## Self-Review

**Spec coverage:**
- Source via Slack `users` read action → `fetchSlackUsers` (Task 1). ✓
- People-only filter (deleted/bot/app_user/Slackbot) → `toPeople` + tests (Task 1). ✓
- Name fallback real_name → display_name → name, sorted case-insensitive → `toPeople` + tests (Task 1). ✓
- Cache with TTL + force refresh → `createSlackUserCache` + tests (Task 1). ✓
- `GET /api/slack-users` + `?refresh=1`, 502 on error → Task 2. ✓
- `createServer(db, slackUsers)` injection + existing tests updated → Task 2. ✓
- `index.ts` wires real cache → Task 2. ✓
- Dropdown replaces input, refresh control, load on open, error/empty states → Task 3. ✓
- `slack_target` field name unchanged so POST path/validation identical → confirmed (Task 3 keeps `name="slack_target"`). ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code.

**Type consistency:** `SlackUser {id,name}`, `SlackUserCache {get(forceRefresh?)}`, and `toPeople`/`fetchSlackUsers`/`createSlackUserCache` names are identical across Task 1 definitions, Task 2 usage (server import + index wiring), and tests. `createServer(db, slackUsers)` arity matches every call site (server.test.ts `withServer`, index.ts). Endpoint path `/api/slack-users` and query flag `refresh=1` consistent across server, tests, frontend, and verification. ✓
