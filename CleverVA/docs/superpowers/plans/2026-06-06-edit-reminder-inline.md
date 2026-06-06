# Edit Scheduled Reminder (Inline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline editing to pending reminder cards in the Scheduled tab.

**Architecture:** Three layers — a new `update()` DB method, a `PATCH /api/reminders/:id` server route (same validation as POST), and inline form logic in `app.js` that swaps a card between read-only and edit mode. CSS adds button and form styles. No new files.

**Tech Stack:** TypeScript (tsx), Express, better-sqlite3, vanilla JS, CSS custom properties

---

### Task 1: Add `update()` to `db.ts`

**Files:**
- Modify: `CleverVA/db.ts`

- [ ] **Step 1: Add `UpdateReminder` interface after `NewReminder`**

After the closing brace of `NewReminder` (line 28), add:

```typescript
export interface UpdateReminder {
  client_name?: string;
  slack_target?: string;
  message?: string;
  send_at?: string;
  channel?: "slack" | "gmail";
  email?: string | null;
}
```

- [ ] **Step 2: Add `update()` method to the returned object**

Inside the `return { … }` block in `openDb`, after the `cancel` method, add:

```typescript
    update(id: number, fields: UpdateReminder): Reminder | undefined {
      const allowed: (keyof UpdateReminder)[] = [
        "client_name", "slack_target", "message", "send_at", "channel", "email",
      ];
      const entries = (Object.keys(fields) as (keyof UpdateReminder)[])
        .filter((k) => allowed.includes(k) && fields[k] !== undefined);
      if (!entries.length) return get(id);
      const setClauses = entries.map((k) => `${k} = ?`).join(", ");
      const values = entries.map((k) => fields[k] ?? null);
      const info = db
        .prepare(`UPDATE reminders SET ${setClauses} WHERE id = ? AND status = 'pending'`)
        .run(...values, id);
      return info.changes > 0 ? get(id) : undefined;
    },
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/deborahbutler/Documents/Zapier
npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/deborahbutler/Documents/Zapier
git add CleverVA/db.ts
git commit -m "feat: add update() method to db Store"
```

---

### Task 2: Add `PATCH /api/reminders/:id` to `server.ts`

**Files:**
- Modify: `CleverVA/server.ts`

- [ ] **Step 1: Add the PATCH route**

After the `app.get("/api/reminders", …)` block and before the `app.get("/api/slack-users", …)` block, add:

```typescript
  app.patch("/api/reminders/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "invalid id" });
      return;
    }

    const { client_name, slack_target, message, send_at, channel, email } = req.body ?? {};
    const fields: Record<string, unknown> = {};

    if (client_name !== undefined) {
      if (typeof client_name !== "string" || client_name.trim().length === 0) {
        res.status(400).json({ error: "client_name must be a non-empty string" });
        return;
      }
      fields.client_name = client_name.trim();
    }

    if (message !== undefined) {
      if (typeof message !== "string" || message.trim().length === 0) {
        res.status(400).json({ error: "message must be a non-empty string" });
        return;
      }
      fields.message = message.trim();
    }

    if (send_at !== undefined) {
      const parsed = Date.parse(send_at);
      if (Number.isNaN(parsed)) {
        res.status(400).json({ error: "send_at is not a valid date/time" });
        return;
      }
      fields.send_at = new Date(parsed).toISOString();
    }

    if (channel !== undefined) {
      if (channel !== "slack" && channel !== "gmail") {
        res.status(400).json({ error: "channel must be 'slack' or 'gmail'" });
        return;
      }
      fields.channel = channel;
    }

    const effectiveChannel = (fields.channel ?? db.get(id)?.channel) as string | undefined;

    if (effectiveChannel === "slack") {
      if (slack_target !== undefined) {
        if (typeof slack_target !== "string" || slack_target.trim().length === 0) {
          res.status(400).json({ error: "slack_target must be a non-empty string" });
          return;
        }
        fields.slack_target = slack_target.trim();
      }
    } else if (effectiveChannel === "gmail") {
      if (email !== undefined) {
        const e = typeof email === "string" ? email.trim() : "";
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
          res.status(400).json({ error: "a valid email is required for an email reminder" });
          return;
        }
        fields.email = e;
        fields.slack_target = "";
      }
    }

    const updated = db.update(id, fields as import("./db.ts").UpdateReminder);
    if (!updated) {
      res.status(404).json({ error: "reminder not found or already sent" });
      return;
    }
    res.json(updated);
  });
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/deborahbutler/Documents/Zapier
npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/deborahbutler/Documents/Zapier
git add CleverVA/server.ts
git commit -m "feat: add PATCH /api/reminders/:id route"
```

---

### Task 3: Add edit/save/discard CSS to `styles.css`

**Files:**
- Modify: `CleverVA/public/styles.css`

- [ ] **Step 1: Append styles at the end of the file**

```css
/* ── Inline edit ── */
.edit-btn {
  background: none;
  border: 1.5px solid var(--border);
  color: var(--primary);
  border-radius: 8px;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  font-weight: 500;
  margin-right: 8px;
  transition: border-color 0.15s, background 0.15s;
}

.edit-btn:hover {
  background: #E8EDFB;
  border-color: var(--primary);
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 0;
  margin-top: 4px;
}

.card-edit-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 4px;
}

.card-edit-form input,
.card-edit-form textarea,
.card-edit-form select {
  font-size: 14px;
  padding: 9px 12px;
}

.card-edit-form textarea {
  min-height: 80px;
}

.card-edit-channels {
  display: flex;
  gap: 8px;
}

.card-edit-form-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.save-btn {
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 7px 18px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  font-weight: 600;
  transition: background 0.15s;
}

.save-btn:hover { background: var(--primary-hover); }

.discard-btn {
  background: none;
  border: 1.5px solid var(--border);
  color: var(--muted);
  border-radius: 8px;
  padding: 7px 14px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  font-weight: 500;
  transition: border-color 0.15s, color 0.15s;
}

.discard-btn:hover {
  border-color: var(--muted);
  color: var(--text);
}

.card-edit-error {
  color: var(--fail);
  font-size: 13px;
  background: var(--fail-bg);
  border: 1px solid var(--fail-border);
  border-radius: 6px;
  padding: 8px 10px;
  display: none;
}

.card-edit-error.visible { display: block; }
```

- [ ] **Step 2: Commit**

```bash
cd /Users/deborahbutler/Documents/Zapier
git add CleverVA/public/styles.css
git commit -m "feat: add inline edit card styles"
```

---

### Task 4: Add inline edit logic to `app.js`

**Files:**
- Modify: `CleverVA/public/app.js`

This task has three sub-steps: helper functions, updated card rendering, and event wiring.

- [ ] **Step 1: Add `toLocalDatetimeValue` helper**

After the `esc` function (around line 18), add:

```javascript
function toLocalDatetimeValue(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
```

- [ ] **Step 2: Add `buildEditForm` helper**

After `toLocalDatetimeValue`, add:

```javascript
function buildEditForm(r, slackPeopleOptions) {
  const isGmail = r.channel === "gmail";
  return `
    <form class="card-edit-form" data-id="${r.id}">
      <input name="client_name" value="${esc(r.client_name)}" placeholder="Client name" required />
      <div class="card-edit-channels">
        <button type="button" class="channel-btn${!isGmail ? " active" : ""}" data-ch="slack">
          <i data-lucide="message-circle"></i> Slack
        </button>
        <button type="button" class="channel-btn${isGmail ? " active" : ""}" data-ch="gmail">
          <i data-lucide="mail"></i> Email
        </button>
        <input type="hidden" name="channel" value="${r.channel}" />
      </div>
      <div class="edit-field-slack"${isGmail ? ' style="display:none"' : ""}>
        <select name="slack_target">
          ${slackPeopleOptions}
        </select>
      </div>
      <div class="edit-field-gmail"${!isGmail ? ' style="display:none"' : ""}>
        <input name="email" type="email" value="${esc(r.email || "")}" placeholder="client@example.com" />
      </div>
      <textarea name="message" required>${esc(r.message)}</textarea>
      <input name="send_at" type="datetime-local" value="${toLocalDatetimeValue(r.send_at)}" required />
      <div class="card-edit-form-actions">
        <button type="submit" class="save-btn">Save</button>
        <button type="button" class="discard-btn">Discard</button>
      </div>
      <p class="card-edit-error"></p>
    </form>`;
}
```

- [ ] **Step 3: Add `buildSlackOptions` helper**

After `buildEditForm`, add:

```javascript
function buildSlackOptions(currentTarget) {
  const cached = window.__slackPeople || [];
  if (!cached.length) return `<option value="${esc(currentTarget)}">${esc(currentTarget)}</option>`;
  return cached.map((p) =>
    `<option value="${esc(p.id)}"${p.id === currentTarget ? " selected" : ""}>${esc(p.name)}</option>`
  ).join("");
}
```

- [ ] **Step 4: Cache the slack people list**

In the existing `loadPeople` function, after the line `const people = await res.json();`, add:

```javascript
    window.__slackPeople = people;
```

- [ ] **Step 5: Update `renderUpcoming` card template**

Replace the existing card template inside `renderUpcoming` (the `<li class="card">…</li>` block):

```javascript
  list.innerHTML = filtered
    .map(
      (r) => `
      <li class="card" data-id="${r.id}">
        <div class="card-read">
          <div class="row">
            <span class="client">${esc(r.client_name)}</span>
            <span class="when">${fmt(r.send_at)}</span>
          </div>
          <div class="target">${fmtTarget(r)}</div>
          <p class="message">${esc(r.message)}</p>
          <div class="card-actions">
            <button class="edit-btn" data-id="${r.id}">Edit</button>
            <button class="cancel" data-id="${r.id}">Cancel</button>
          </div>
        </div>
      </li>`,
    )
    .join("");
```

- [ ] **Step 6: Replace the cancel event-wiring block**

Replace the existing block:
```javascript
  list.querySelectorAll(".cancel").forEach((b) =>
    b.addEventListener("click", async () => {
      await fetch(`/api/reminders/${b.dataset.id}`, { method: "DELETE" });
      loadUpcoming();
    }),
  );
```

With:
```javascript
  list.querySelectorAll(".cancel").forEach((b) =>
    b.addEventListener("click", async () => {
      await fetch(`/api/reminders/${b.dataset.id}`, { method: "DELETE" });
      loadUpcoming();
    }),
  );

  list.querySelectorAll(".edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      // Close any other open edit form first
      list.querySelectorAll(".card[data-editing]").forEach((other) => {
        if (other !== btn.closest(".card")) collapseEditForm(other);
      });
      const card = btn.closest(".card");
      if (card.dataset.editing) return;
      expandEditForm(card);
    });
  });

  lucide.createIcons();
```

- [ ] **Step 7: Add `expandEditForm` and `collapseEditForm` functions**

After the `renderUpcoming` function, add:

```javascript
function expandEditForm(card) {
  const id = Number(card.dataset.id);
  const r = upcomingItems.find((x) => x.id === id);
  if (!r) return;
  card.dataset.editing = "1";
  const readDiv = card.querySelector(".card-read");
  readDiv.style.display = "none";
  const formHtml = buildEditForm(r, buildSlackOptions(r.slack_target));
  card.insertAdjacentHTML("beforeend", formHtml);
  lucide.createIcons();

  const form = card.querySelector(".card-edit-form");

  // Channel toggle inside the edit form
  form.querySelectorAll(".channel-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      form.querySelectorAll(".channel-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const ch = btn.dataset.ch;
      form.querySelector("input[name='channel']").value = ch;
      form.querySelector(".edit-field-slack").style.display = ch === "slack" ? "" : "none";
      form.querySelector(".edit-field-gmail").style.display = ch === "gmail" ? "" : "none";
    });
  });

  form.querySelector(".discard-btn").addEventListener("click", () => collapseEditForm(card));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const errEl = form.querySelector(".card-edit-error");
    errEl.classList.remove("visible");
    const res = await fetch(`/api/reminders/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const updated = await res.json();
      const idx = upcomingItems.findIndex((x) => x.id === id);
      if (idx !== -1) upcomingItems[idx] = updated;
      collapseEditForm(card);
      renderUpcoming();
    } else {
      const body = await res.json().catch(() => ({}));
      errEl.textContent = body.error || "Could not save changes.";
      errEl.classList.add("visible");
    }
  });
}

function collapseEditForm(card) {
  delete card.dataset.editing;
  const form = card.querySelector(".card-edit-form");
  if (form) form.remove();
  const readDiv = card.querySelector(".card-read");
  if (readDiv) readDiv.style.display = "";
}
```

- [ ] **Step 8: Commit**

```bash
cd /Users/deborahbutler/Documents/Zapier
git add CleverVA/public/app.js
git commit -m "feat: inline edit form for pending reminder cards"
```

---

## Verification

1. Start the server: `npm start` (from `/Users/deborahbutler/Documents/Zapier`)
2. Open `http://localhost:4321` and schedule a test reminder.
3. Click the **Scheduled** tab — confirm an **Edit** button appears on the card alongside Cancel.
4. Click **Edit** — confirm the card expands with pre-filled fields (client name, message, datetime, channel, slack person).
5. Change the client name and click **Save** — confirm the card snaps back to read-only with the new name.
6. Click **Edit** again, change something, then click **Discard** — confirm original values are restored.
7. Open two cards' edit forms simultaneously — confirm opening the second one closes the first.
8. Verify the PATCH API rejects invalid data:
   ```bash
   curl -s -X PATCH http://localhost:4321/api/reminders/1 \
     -H "content-type: application/json" \
     -d '{"send_at":"not-a-date"}' | jq .
   ```
   Expected: `{"error":"send_at is not a valid date/time"}`
