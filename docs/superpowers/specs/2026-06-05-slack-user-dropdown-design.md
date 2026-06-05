# Slack User Dropdown — Design

**Date:** 2026-06-05
**Status:** Approved
**Builds on:** [Clever VA Reminders](2026-06-05-clever-va-reminders-design.md)

## Summary

Replace the free-text "Slack target (member ID)" field on the Add Reminder form
with a dropdown of real Slack people, so the user selects a name instead of
looking up an ID. The selected member ID still flows through the existing
send path unchanged.

## Motivation

Typing a raw member ID is error-prone — an early test failed with Slack
`channel_not_found` because a DM-channel ID (`D…`) was entered instead of a
member ID (`U…`). A dropdown removes the lookup entirely.

## Decisions

- **Source:** The Zapier Slack `users` read action (`runAction({ app: "slack",
  actionType: "read", action: "users" })`), which returns full member objects
  with `id`, `real_name`, `profile.display_name`, `is_bot`, `is_app_user`,
  `deleted`. Reuses the existing connection (`CONNECTION_ID`) — no new auth.
- **Filtering ("people only"):** Exclude members where `deleted`, `is_bot`, or
  `is_app_user` is true, plus Slackbot (`id === "USLACKBOT"`). Map survivors to
  `{ id, name }` where `name = real_name || profile.display_name || name`. Sort
  by `name`, case-insensitive.
- **Freshness:** Server caches the list with a 10-minute TTL and a manual
  refresh. Dropdown opens instantly; `GET /api/slack-users?refresh=1` forces a
  refetch.
- **UI:** Native `<select>` (≈50 people; no search-as-you-type needed). A small
  "↻ Refresh people" control re-fetches with `refresh=1`.

## Architecture

New file `CleverVA/slack-users.ts`, kept separate from the sender `slack.ts`:

- `export interface SlackUser { id: string; name: string; }`
- `export function toPeople(rawMembers: any[]): SlackUser[]` — pure function:
  filters out deleted/bot/app-user/Slackbot, maps to `{id, name}`, sorts by
  name case-insensitive. (Pure → unit-testable with no live calls.)
- `export async function fetchSlackUsers(): Promise<SlackUser[]>` — runs the
  Slack `users` read action via the Zapier SDK and returns `toPeople(...)`.
  Not unit-tested (hits live SDK), same convention as `zapierSlackSender`.
- `export type SlackUserCache = { get(forceRefresh?: boolean): Promise<SlackUser[]> }`
- `export function createSlackUserCache(fetcher: () => Promise<SlackUser[]>, ttlMs = 600_000, now = () => Date.now()): SlackUserCache`
  — caches the array + fetch timestamp. `get(force)` refetches when `force`,
  when nothing is cached, or when `now() - fetchedAt >= ttlMs`; otherwise
  returns the cached array. `now` is injectable for deterministic tests.

`server.ts` — signature becomes `createServer(db, slackUsers: SlackUserCache)`:

- `GET /api/slack-users` → `res.json(await slackUsers.get(req.query.refresh === "1"))`.
- On fetch error, respond `502` with `{ error }` so the UI can show a message.
- Existing routes unchanged.

`index.ts` — build the real cache and inject it:
```ts
const slackUsers = createSlackUserCache(fetchSlackUsers);
const app = createServer(db, slackUsers);
```

## Frontend (`public/`)

- `index.html`: replace the Slack-target `<input>` with:
  ```html
  <label>Slack person
    <select name="slack_target" id="slack-target" required>
      <option value="">Loading people…</option>
    </select>
  </label>
  <button type="button" id="refresh-people" class="linkish">↻ Refresh people</button>
  ```
- `app.js`:
  - `loadPeople(force)` — `GET /api/slack-users` (append `?refresh=1` when
    forced), replace the `<select>` options with one `<option value=id>name</option>`
    per person plus a leading disabled placeholder. On error or empty list, set a
    single disabled option ("Couldn't load people — try Refresh") and surface a
    message.
  - Call `loadPeople(false)` on page load.
  - Wire the Refresh button to `loadPeople(true)`.
  - The submit handler is unchanged — `slack_target` is read from the select's
    value (a member ID), so the POST body and validation are identical to today.
- `styles.css`: style `select` to match the existing inputs; add a small
  `.linkish` button style for the refresh control.

## Testing

- `slack-users.test.ts` (node:test, no live calls):
  - `toPeople` drops deleted, `is_bot`, `is_app_user`, and Slackbot; keeps real
    people; maps to `{id, name}` using real_name → display_name → name fallback;
    sorts case-insensitively by name.
  - `createSlackUserCache`: first `get()` calls the fetcher; second `get()`
    within TTL returns cached without re-calling; `get(true)` forces a refetch;
    advancing `now` past the TTL triggers a refetch. Use a counting fake fetcher
    and an injectable clock.
- `server.test.ts`: update `withServer` to pass a fake cache; add tests that
  `GET /api/slack-users` returns the list and `?refresh=1` calls the cache with
  `force = true`. Existing 6 tests keep passing (pass a stub cache).
- Dropdown population + refresh verified manually against the live workspace.

## Out of scope (YAGNI)

- Channel (C…) messaging.
- Search-as-you-type / typeahead.
- Persisting or editing the directory.
- Per-user avatars in the dropdown.
