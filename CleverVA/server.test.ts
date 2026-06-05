import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { openDb } from "./db.ts";
import { createServer } from "./server.ts";

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

const valid = {
  client_name: "Acme",
  slack_target: "U1",
  message: "ping",
  send_at: "2026-06-06T09:00:00.000Z",
};

test("POST creates a reminder and it appears in pending", async () => {
  await withServer(async (base) => {
    const post = await fetch(`${base}/api/reminders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(valid),
    });
    assert.equal(post.status, 201);

    const list = await (await fetch(`${base}/api/reminders?status=pending`)).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].client_name, "Acme");
  });
});

test("POST with a missing field returns 400", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/reminders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...valid, message: "" }),
    });
    assert.equal(res.status, 400);
  });
});

test("POST with a whitespace-only client_name returns 400", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/reminders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...valid, client_name: "   " }),
    });
    assert.equal(res.status, 400);
  });
});

test("POST with an unparseable send_at returns 400", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/reminders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...valid, send_at: "not-a-date" }),
    });
    assert.equal(res.status, 400);
  });
});

test("DELETE cancels a pending reminder", async () => {
  await withServer(async (base) => {
    const created = await (
      await fetch(`${base}/api/reminders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(valid),
      })
    ).json();

    const del = await fetch(`${base}/api/reminders/${created.id}`, { method: "DELETE" });
    assert.equal(del.status, 204);

    const list = await (await fetch(`${base}/api/reminders?status=pending`)).json();
    assert.equal(list.length, 0);
  });
});

test("DELETE of a missing id returns 404", async () => {
  await withServer(async (base) => {
    const del = await fetch(`${base}/api/reminders/999999`, { method: "DELETE" });
    assert.equal(del.status, 404);
  });
});

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
