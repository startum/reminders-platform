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
  assert.equal(jo.name, "Jo");
  assert.equal(debs.name, "Debs");
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
  assert.equal(a, b);
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

  await cache.get();
  clock = 1000 + 10_000;
  await cache.get();
  assert.equal(calls, 2);
});

test("toPeople falls back to id when no name fields are present", () => {
  const people = toPeople([
    { id: "UEMPTY", name: "", real_name: "", is_bot: false, is_app_user: false, deleted: false },
  ]);
  assert.deepEqual(people, [{ id: "UEMPTY", name: "UEMPTY" }]);
});

test("concurrent get() calls share a single fetch", async () => {
  let calls = 0;
  let resolveFetch;
  const fetcher = () => {
    calls++;
    return new Promise((resolve) => { resolveFetch = () => resolve([{ id: "U1", name: "One" }]); });
  };
  const cache = createSlackUserCache(fetcher, 10_000, () => 1000);

  const p1 = cache.get();
  const p2 = cache.get();   // fired before the first fetch resolves
  resolveFetch();
  const [a, b] = await Promise.all([p1, p2]);

  assert.equal(calls, 1);   // only one underlying fetch
  assert.deepEqual(a, [{ id: "U1", name: "One" }]);
  assert.equal(a, b);
});
