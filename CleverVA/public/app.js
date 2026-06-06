const panels = document.querySelectorAll(".panel");
const tabs = document.querySelectorAll(".tab");

function show(name) {
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  panels.forEach((p) => p.classList.toggle("active", p.id === name));
  if (name === "upcoming") loadUpcoming();
  if (name === "sent") loadSent();
}
tabs.forEach((t) => t.addEventListener("click", () => show(t.dataset.tab)));

function fmt(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toLocalDatetimeValue(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildSlackOptions(currentTarget) {
  const cached = window.__slackPeople || [];
  if (!cached.length) return `<option value="${esc(currentTarget)}">${esc(currentTarget)}</option>`;
  return cached.map((p) =>
    `<option value="${esc(p.id)}"${p.id === currentTarget ? " selected" : ""}>${esc(p.name)}</option>`
  ).join("");
}

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

const slackTarget = document.getElementById("slack-target");

async function loadPeople(force = false) {
  slackTarget.innerHTML = `<option value="">Loading people…</option>`;
  try {
    const res = await fetch(`/api/slack-users${force ? "?refresh=1" : ""}`);
    if (!res.ok) throw new Error("request failed");
    const people = await res.json();
    window.__slackPeople = people;
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

// ── Relative scheduling ──
const customDateInput = document.getElementById("send_at");

function resolvePreset(preset) {
  const now = new Date();
  switch (preset) {
    case "1hour":
      return new Date(now.getTime() + 60 * 60 * 1000);
    case "tomorrow_morning": {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    }
    case "tomorrow_afternoon": {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(14, 0, 0, 0);
      return d;
    }
    case "next_monday": {
      const d = new Date(now);
      const day = d.getDay(); // 0=Sun … 6=Sat
      const daysToAdd = day === 0 ? 1 : day === 1 ? 7 : 8 - day;
      d.setDate(d.getDate() + daysToAdd);
      d.setHours(9, 0, 0, 0);
      return d;
    }
    default:
      return null;
  }
}

document.querySelectorAll("input[name='schedule_preset']").forEach((radio) => {
  radio.addEventListener("change", () => {
    const isCustom = radio.value === "custom";
    customDateInput.classList.toggle("visible", isCustom);
    if (!isCustom) customDateInput.value = "";
    updatePreview();
  });
});

const form = document.getElementById("reminder-form");
const formMsg = document.getElementById("form-msg");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));

  const preset = data.schedule_preset;
  if (!preset) {
    formMsg.textContent = "Please select a send time.";
    formMsg.className = "msg err";
    return;
  }

  if (preset === "custom") {
    if (!data.send_at) {
      formMsg.textContent = "Please select a custom date and time.";
      formMsg.className = "msg err";
      return;
    }
    data.send_at = new Date(data.send_at).toISOString();
  } else {
    data.send_at = resolvePreset(preset).toISOString();
  }
  delete data.schedule_preset;

  const res = await fetch("/api/reminders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  if (res.ok) {
    form.reset();
    customDateInput.classList.remove("visible");
    updatePreview();
    formMsg.innerHTML = `<strong>✓ Reminder Scheduled</strong><br>Your reminder has been successfully queued for delivery.`;
    formMsg.className = "msg ok";
    show("upcoming");
  } else {
    const body = await res.json().catch(() => ({}));
    formMsg.textContent = body.error || "Could not schedule reminder.";
    formMsg.className = "msg err";
  }
});

let upcomingItems = [];

async function loadUpcoming() {
  upcomingItems = await (await fetch("/api/reminders?status=pending")).json();
  renderUpcoming();
}

function renderUpcoming() {
  const search = (document.getElementById("upcoming-search")?.value || "").toLowerCase().trim();
  const activeFilter = document.querySelector(".filter-chip.active")?.dataset.filter || "all";

  const now = new Date();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const weekEnd = new Date(todayEnd.getTime() + 6 * 24 * 60 * 60 * 1000);

  const filtered = upcomingItems.filter((r) => {
    if (search) {
      const haystack = `${r.client_name} ${r.message} ${r.slack_target}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (activeFilter === "today") return new Date(r.send_at) <= todayEnd;
    if (activeFilter === "week") return new Date(r.send_at) <= weekEnd;
    return true;
  });

  const list = document.getElementById("upcoming-list");
  const empty = document.getElementById("upcoming-empty");

  if (!filtered.length) {
    list.innerHTML = "";
    empty.style.display = "block";
    empty.textContent = search || activeFilter !== "all"
      ? "No reminders match your search."
      : "No upcoming reminders.";
    return;
  }

  empty.style.display = "none";
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
  list.querySelectorAll(".cancel").forEach((b) =>
    b.addEventListener("click", async () => {
      await fetch(`/api/reminders/${b.dataset.id}`, { method: "DELETE" });
      loadUpcoming();
    }),
  );
  list.querySelectorAll(".edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      list.querySelectorAll(".card[data-editing]").forEach((other) => {
        if (other !== btn.closest(".card")) collapseEditForm(other);
      });
      const card = btn.closest(".card");
      if (card.dataset.editing) return;
      expandEditForm(card);
    });
  });
  lucide.createIcons();
}

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

document.getElementById("upcoming-search").addEventListener("input", renderUpcoming);
document.querySelectorAll(".filter-chip").forEach((chip) =>
  chip.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    renderUpcoming();
  }),
);

async function loadSent() {
  const items = await (await fetch("/api/reminders?status=sent")).json();
  const list = document.getElementById("sent-list");
  document.getElementById("sent-empty").style.display = items.length ? "none" : "block";
  list.innerHTML = items
    .map(
      (r) => `
      <li class="card ${r.status === "failed" ? "failed" : ""}">
        <div class="row">
          <span class="client">${esc(r.client_name)}</span>
          <span class="when">${fmt(r.sent_at)}</span>
        </div>
        <div class="target">${fmtTarget(r)}</div>
        <p class="message">${esc(r.message)}</p>
        ${r.status === "failed" ? `<p class="error">Failed: ${esc(r.error || "unknown error")}</p>` : ""}
      </li>`,
    )
    .join("");
}

// ── Channel selector ──
const channelInput = document.getElementById("channel-input");

function fmtTarget(r) {
  if (r.channel === "gmail") return `via email · ${esc(r.email || "")}`;
  return `via Slack · ${esc(r.slack_target)}`;
}

document.querySelectorAll(".channel-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".channel-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const ch = btn.dataset.channel;
    channelInput.value = ch;
    document.getElementById("field-slack").style.display = ch === "slack" ? "" : "none";
    document.getElementById("field-gmail").style.display = ch === "gmail" ? "" : "none";
    lucide.createIcons();
    updatePreview();
  });
});

// ── Live preview ──
function fmtPreviewDate(val) {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d)) return null;
  const date = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time}`;
}

const categoryLabels = {
  medical: "Medical",
  appointment: "Appointment",
  meeting: "Meeting",
  daily_living: "Daily Living",
  medication: "Medication",
  travel: "Travel",
  custom: "Custom",
};

function updatePreview() {
  const clientEl = document.getElementById("preview-client");
  const categoryEl = document.getElementById("preview-category");
  const messageEl = document.getElementById("preview-message");
  const dateEl = document.getElementById("preview-date");
  const recipientEl = document.getElementById("preview-recipient");

  const clientVal = (document.getElementById("client_name") || {}).value || "";
  const categoryInput = document.querySelector("input[name='category']:checked");
  const categoryVal = categoryInput ? (categoryLabels[categoryInput.value] || categoryInput.value) : "";
  const messageVal = (document.getElementById("message") || {}).value || "";
  const ch = channelInput ? channelInput.value : "slack";
  let recipientVal = "";
  if (ch === "gmail") {
    recipientVal = (document.getElementById("email-input") || {}).value || "";
  } else {
    const slackOpt = slackTarget.options[slackTarget.selectedIndex];
    recipientVal = (slackOpt && slackOpt.value) ? `@${slackOpt.text}` : "";
  }

  const presetInput = document.querySelector("input[name='schedule_preset']:checked");
  let previewDate = null;
  if (presetInput) {
    if (presetInput.value === "custom") {
      previewDate = customDateInput.value ? fmtPreviewDate(new Date(customDateInput.value)) : null;
    } else {
      const resolved = resolvePreset(presetInput.value);
      previewDate = resolved ? fmtPreviewDate(resolved) : null;
    }
  }

  const set = (el, val) => {
    if (val) {
      el.textContent = val;
      el.classList.remove("empty-state");
    } else {
      el.textContent = "—";
      el.classList.add("empty-state");
    }
  };

  set(clientEl, clientVal);
  set(categoryEl, categoryVal);
  set(messageEl, messageVal);
  set(dateEl, previewDate);
  set(recipientEl, recipientVal || "");
}

document.getElementById("client_name").addEventListener("input", updatePreview);
document.getElementById("message").addEventListener("input", updatePreview);
document.getElementById("email-input").addEventListener("input", updatePreview);
customDateInput.addEventListener("change", updatePreview);
slackTarget.addEventListener("change", updatePreview);
document.querySelectorAll("input[name='category']").forEach((r) =>
  r.addEventListener("change", updatePreview),
);

show("add");
loadPeople();
lucide.createIcons();
