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

const form = document.getElementById("reminder-form");
const formMsg = document.getElementById("form-msg");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  // datetime-local has no timezone; convert local wall-clock to ISO.
  data.send_at = new Date(data.send_at).toISOString();
  const res = await fetch("/api/reminders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  if (res.ok) {
    form.reset();
    formMsg.textContent = "Scheduled.";
    formMsg.className = "msg ok";
    show("upcoming");
  } else {
    const body = await res.json().catch(() => ({}));
    formMsg.textContent = body.error || "Could not schedule reminder.";
    formMsg.className = "msg err";
  }
});

async function loadUpcoming() {
  const items = await (await fetch("/api/reminders?status=pending")).json();
  const list = document.getElementById("upcoming-list");
  document.getElementById("upcoming-empty").style.display = items.length ? "none" : "block";
  list.innerHTML = items
    .map(
      (r) => `
      <li class="card">
        <div class="row">
          <span class="client">${esc(r.client_name)}</span>
          <span class="when">${fmt(r.send_at)}</span>
        </div>
        <div class="target">to ${esc(r.slack_target)}</div>
        <p class="message">${esc(r.message)}</p>
        <button class="cancel" data-id="${r.id}">Cancel</button>
      </li>`,
    )
    .join("");
  list.querySelectorAll(".cancel").forEach((b) =>
    b.addEventListener("click", async () => {
      await fetch(`/api/reminders/${b.dataset.id}`, { method: "DELETE" });
      loadUpcoming();
    }),
  );
}

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
        <div class="target">to ${esc(r.slack_target)}</div>
        <p class="message">${esc(r.message)}</p>
        ${r.status === "failed" ? `<p class="error">Failed: ${esc(r.error || "unknown error")}</p>` : ""}
      </li>`,
    )
    .join("");
}

show("add");
loadPeople();
