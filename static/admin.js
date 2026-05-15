// ============================================================
// GLOBAL HAIR SALOON — Admin · New-Gen JS
// ============================================================

const DAYS_SHORT  = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DAYS_FULL   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS_FULL = ["January","February","March","April","May","June",
                     "July","August","September","October","November","December"];

const OPEN_HOUR   = 8;       // 08:00
const CLOSE_HOUR  = 22.25;   // 22:15

let state = {
  date:     todayISO(),
  bookings: [],
  slots:    [],
  filter:   "all",
};

// ── utils ──────────────────────────────────────────────────
function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, m =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[m]);
}

function initials(name) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || parts[0]?.[1] || "")).toUpperCase();
}

function timeToHours(timeStr) {
  // "9:00 AM" → 9.0,  "10:45 PM" → 22.75
  const [hm, period] = timeStr.split(" ");
  let [h, m] = hm.split(":").map(Number);
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h + m / 60;
}


// ── INIT ───────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  startClock();
  buildDateStrip();
  bindFilters();
  bindDialog();
  loadDate(state.date);

  document.getElementById("dateBack").addEventListener("click", () => shiftStrip(-7));
  document.getElementById("dateFwd").addEventListener("click",  () => shiftStrip(+7));
  document.getElementById("datePicker").addEventListener("change", e => {
    if (e.target.value) loadDate(e.target.value);
  });
});


// ── LIVE CLOCK ─────────────────────────────────────────────
function startClock() {
  const tick = () => {
    const n = new Date();
    document.getElementById("navClock").textContent =
      n.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) + " IST";
  };
  tick();
  setInterval(tick, 1000 * 30);
}


// ── DATE STRIP ─────────────────────────────────────────────
let stripCenter = new Date();   // center date of currently rendered window

function buildDateStrip(center = new Date()) {
  stripCenter = new Date(center);
  const track = document.getElementById("dateTrack");
  track.innerHTML = "";

  // build 21 days: 10 before, center, 10 after
  for (let i = -10; i <= 10; i++) {
    const d = new Date(center);
    d.setDate(d.getDate() + i);
    const iso = toISO(d);
    const isToday    = iso === todayISO();
    const isSelected = iso === state.date;
    const isPast     = iso < todayISO();

    const pill = document.createElement("button");
    pill.className = "date-pill" +
                     (isToday ? " today" : "") +
                     (isSelected ? " selected" : "") +
                     (isPast && !isSelected ? " past" : "");
    pill.dataset.iso = iso;
    pill.innerHTML = `
      <span class="dow">${DAYS_SHORT[d.getDay()]}</span>
      <span class="day">${d.getDate()}</span>
    `;
    pill.addEventListener("click", () => loadDate(iso));
    track.appendChild(pill);
  }

  // center selected pill in view
  requestAnimationFrame(() => {
    const sel = track.querySelector(".selected");
    if (sel) {
      sel.scrollIntoView({ behavior: "instant", block: "nearest", inline: "center" });
    }
  });
}

function shiftStrip(days) {
  const d = new Date(stripCenter);
  d.setDate(d.getDate() + days);
  buildDateStrip(d);
}


// ── LOAD DATA ──────────────────────────────────────────────
async function loadDate(dateStr) {
  state.date = dateStr;
  document.getElementById("datePicker").value = dateStr;

  // update selected pill
  document.querySelectorAll(".date-pill").forEach(p => {
    p.classList.toggle("selected", p.dataset.iso === dateStr);
  });

  // skeleton state
  document.getElementById("apptList").innerHTML =
    '<li class="skel"></li><li class="skel"></li><li class="skel"></li>';

  try {
    const [bRes, sRes] = await Promise.all([
      fetch(`/admin/bookings?date=${dateStr}`),
      fetch(`/slots?date=${dateStr}`)
    ]);
    const bData = await bRes.json();
    const sData = await sRes.json();

    if (!bData.success || !sData.success) {
      document.getElementById("apptList").innerHTML =
        `<li class="empty">${bData.error || sData.error || "Unable to load"}</li>`;
      return;
    }

    state.bookings = bData.bookings || [];
    state.slots    = sData.slots    || [];

    renderHero(dateStr);
    renderKPIs();
    renderTimeline();
    renderFilters();
    renderAppointments();
    renderSlots();

  } catch (e) {
    document.getElementById("apptList").innerHTML =
      `<li class="empty">A line went quiet — ${escape(e.message)}</li>`;
  }
}


// ── HERO ───────────────────────────────────────────────────
function renderHero(dateStr) {
  const d   = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const isToday = dateStr === todayISO();
  const isPast  = dateStr < todayISO();

  let greet;
  if (isToday) {
    const h = now.getHours();
    if (h < 12)      greet = "Good morning";
    else if (h < 17) greet = "Good afternoon";
    else             greet = "Good evening";
  } else if (isPast) {
    greet = "Looking back";
  } else {
    greet = "Looking ahead";
  }

  document.getElementById("heroGreet").innerHTML = greet;

  const total   = state.bookings.filter(b => b.status === "confirmed").length;
  const minutes = total * 45;
  const hours   = (minutes / 60).toFixed(1).replace(/\.0$/, "");
  const revenue = state.bookings
                    .filter(b => b.status === "confirmed")
                    .reduce((s, b) => s + (b.service.price || 0), 0);

  // animate count
  animateNumber(document.getElementById("apptCount"), total);

  const dateFmt = `${DAYS_FULL[d.getDay()]}, ${d.getDate()} ${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
  document.getElementById("metaDate").textContent    = dateFmt;
  document.getElementById("metaHours").textContent   = `${hours} hour${hours === "1" ? "" : "s"} of work`;
  document.getElementById("metaRevenue").textContent = `₨ ${revenue.toLocaleString("en-PK")}`;
}


// ── KPIs ───────────────────────────────────────────────────
function renderKPIs() {
  const confirmed = state.bookings.filter(b => b.status === "confirmed").length;
  const total     = state.slots.length;
  const booked    = state.slots.filter(s => !s.available).length;
  const open      = state.slots.filter(s =>  s.available).length;
  const revenue   = state.bookings
                      .filter(b => b.status === "confirmed")
                      .reduce((s, b) => s + (b.service.price || 0), 0);
  const avgTicket = confirmed ? Math.round(revenue / confirmed) : 0;
  const util      = total ? Math.round((booked / total) * 100) : 0;

  animateNumber(document.getElementById("kpiConfirmed"), confirmed);
  animateNumber(document.getElementById("kpiOpen"),       open);
  animateNumber(document.getElementById("kpiRevenue"),   revenue, { commas: true });
  animateNumber(document.getElementById("kpiUtil"),       util);

  document.getElementById("kpiTotal").textContent      = total;
  document.getElementById("kpiAvgTicket").textContent  =
    confirmed ? `avg ₨ ${avgTicket.toLocaleString("en-PK")}` : "no tickets yet";

  // light delta vs benchmark of 4
  const delta = confirmed - 4;
  const el    = document.getElementById("kpiConfirmedDelta");
  el.className = "delta " + (delta > 0 ? "up" : delta < 0 ? "down" : "flat");
  el.textContent = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "±0";
}

function animateNumber(el, target, opts = {}) {
  const duration = 700;
  const start    = performance.now();
  const startVal = 0;
  const commas   = opts.commas;

  function tick(t) {
    const p = Math.min(1, (t - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = Math.round(startVal + (target - startVal) * eased);
    el.textContent = commas ? val.toLocaleString("en-PK") : val;
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}


// ── TIMELINE ───────────────────────────────────────────────
function renderTimeline() {
  const rail = document.getElementById("timelineRail");
  rail.innerHTML = "";

  // grid of hour markers (8-22)
  const grid = document.createElement("div");
  grid.className = "timeline-grid";
  const totalHours = CLOSE_HOUR - OPEN_HOUR;
  for (let h = OPEN_HOUR; h <= Math.floor(CLOSE_HOUR); h++) {
    const col = document.createElement("div");
    col.className = "timeline-hour";
    const label = document.createElement("span");
    label.className = "timeline-hour-label";
    const ampm = h >= 12 ? "p" : "a";
    const hh   = h > 12 ? h - 12 : (h === 0 ? 12 : h);
    label.textContent = `${hh}${ampm}`;
    col.appendChild(label);
    grid.appendChild(col);
  }
  rail.appendChild(grid);

  // appointment blocks
  state.bookings.forEach(b => {
    const startH = timeToHours(b.time_label);
    const dur    = 0.75; // 45 min
    const left   = ((startH - OPEN_HOUR) / totalHours) * 100;
    const width  = (dur / totalHours) * 100;

    if (left < 0 || left > 100) return;

    const block = document.createElement("div");
    block.className = "timeline-block" + (b.status === "cancelled" ? " cancelled" : "");
    block.style.left  = `${left}%`;
    block.style.width = `${width}%`;
    block.title       = `${b.name} · ${b.service.name} · ${b.time_label}`;
    block.textContent = b.name.split(" ")[0];
    rail.appendChild(block);
  });

  // "now" marker — only if viewing today
  if (state.date === todayISO()) {
    const now = new Date();
    const nowH = now.getHours() + now.getMinutes() / 60;
    if (nowH >= OPEN_HOUR && nowH <= CLOSE_HOUR) {
      const left = ((nowH - OPEN_HOUR) / totalHours) * 100;
      const marker = document.createElement("div");
      marker.className = "timeline-now";
      marker.style.left = `${left}%`;
      rail.appendChild(marker);
    }
  }
}


// ── FILTERS ────────────────────────────────────────────────
function bindFilters() {
  document.getElementById("filters").addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    state.filter = chip.dataset.filter;
    renderAppointments();
  });
}

function renderFilters() {
  const confirmed = state.bookings.filter(b => b.status === "confirmed").length;
  const cancelled = state.bookings.filter(b => b.status === "cancelled").length;
  document.getElementById("cAll").textContent  = state.bookings.length;
  document.getElementById("cConf").textContent = confirmed;
  document.getElementById("cCanc").textContent = cancelled;
}


// ── APPOINTMENTS ───────────────────────────────────────────
function renderAppointments() {
  const list = document.getElementById("apptList");
  let bookings = state.bookings;

  if (state.filter !== "all") {
    bookings = bookings.filter(b => b.status === state.filter);
  }

  if (bookings.length === 0) {
    list.innerHTML = `<li class="empty">No ${state.filter === "all" ? "" : state.filter + " "}appointments for this day.</li>`;
    return;
  }

  list.innerHTML = bookings.map(b => {
    const [hm, period] = b.time_label.split(" ");
    const barberChip = b.barber && b.barber.name
      ? `<span class="appt-barber">w/ ${escape(b.barber.name)}</span>`
      : "";
    return `
      <li class="appt ${b.status === "cancelled" ? "cancelled" : ""}" id="row-${b.booking_id}">
        <div class="avatar">${initials(b.name)}</div>
        <div class="appt-main">
          <div class="appt-name">${escape(b.name)}</div>
          <div class="appt-sub">
            <span>${escape(b.service.name)}</span>
            ${barberChip}
            <span class="appt-id">${b.booking_id}</span>
          </div>
        </div>
        <div class="appt-time">
          <span class="h">${hm}</span>
          <span class="p">${period}</span>
        </div>
        <div class="appt-price">Rs. ${b.service.price}</div>
        <div class="appt-status ${b.status}">${b.status}</div>
        <button class="appt-x" aria-label="Cancel"
                onclick="askCancel('${b.booking_id}', '${escape(b.name)}')"
                ${b.status === "cancelled" ? "disabled" : ""}>×</button>
      </li>
    `;
  }).join("");
}


// ── SLOT GRID ──────────────────────────────────────────────
function renderSlots() {
  const grid = document.getElementById("slotGrid");
  const now  = new Date();
  const isToday = state.date === todayISO();

  grid.innerHTML = state.slots.map(s => {
    let cls = s.available ? "available" : "booked";
    let state_ = s.available ? "Open" : "Booked";

    if (isToday && cls === "available") {
      const [h, m] = s.time.split(":").map(Number);
      const slot = new Date(); slot.setHours(h, m, 0, 0);
      if (slot < now) { cls = "past"; state_ = "Past"; }
    }

    const [hm, period] = s.label.split(" ");
    return `
      <div class="slot ${cls}">
        <span class="slot-time">${hm}<span class="small">${period}</span></span>
        <span class="slot-state">${state_}</span>
      </div>
    `;
  }).join("");
}


// ── CANCEL FLOW ────────────────────────────────────────────
let pendingCancel = null;

function askCancel(id, name) {
  pendingCancel = id;
  document.getElementById("dlgTitle").textContent = "Cancel appointment?";
  document.getElementById("dlgMsg").innerHTML =
    `This will strike <strong>${escape(name)}</strong>'s booking <span style="font-family:var(--mono);font-size:11px;opacity:.7">(${id})</span> from today's register. The slot will reopen.`;
  document.getElementById("dlgVeil") || document.getElementById("dialogVeil").classList.add("show");
  document.getElementById("dialogVeil").classList.add("show");
}

function closeDialog() {
  document.getElementById("dialogVeil").classList.remove("show");
  pendingCancel = null;
}

function bindDialog() {
  document.getElementById("dlgCancel").addEventListener("click", closeDialog);
  document.getElementById("dialogVeil").addEventListener("click", e => {
    if (e.target.id === "dialogVeil") closeDialog();
  });
  document.getElementById("dlgOk").addEventListener("click", async () => {
    if (!pendingCancel) return;
    const id = pendingCancel;
    closeDialog();
    await doCancel(id);
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeDialog();
  });
}

async function doCancel(id) {
  try {
    const res  = await fetch(`/admin/bookings/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      toast(`Appointment ${id} cancelled`, "success");
      // optimistic local update
      const b = state.bookings.find(x => x.booking_id === id);
      if (b) b.status = "cancelled";
      // refresh slots
      const sRes = await fetch(`/slots?date=${state.date}`);
      const sData = await sRes.json();
      if (sData.success) state.slots = sData.slots;

      renderHero(state.date);
      renderKPIs();
      renderTimeline();
      renderFilters();
      renderAppointments();
      renderSlots();
    } else {
      toast(`Couldn't cancel — ${data.error}`, "error");
    }
  } catch (e) {
    toast(`A line went quiet — ${e.message}`, "error");
  }
}


// ── TOAST ──────────────────────────────────────────────────
function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById("toastStack").appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 320);
  }, 3500);
}


// ============================================================
// SHOP TOGGLE + WALK-IN + SEARCH + BARBERS
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  loadShopState();
  loadBarbers();
  bindShopToggle();
  bindWalkin();
  bindSearch();
  bindBarberAdd();
});


// ── helpers ─────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add("show"); }
function closeModal(id) { document.getElementById(id).classList.remove("show"); }

document.addEventListener("click", e => {
  if (e.target.classList.contains("modal-veil")) {
    e.target.classList.remove("show");
  }
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-veil.show").forEach(m => m.classList.remove("show"));
  }
});


// ── SHOP STATE ──────────────────────────────────────────────
let shopState = { is_open: true };

async function loadShopState() {
  try {
    const r = await fetch("/admin/salon/state");
    const d = await r.json();
    if (d.success) {
      shopState = d.state;
      renderShopPill();
    }
  } catch (e) {}
}

function renderShopPill() {
  const pill = document.getElementById("shopPill");
  const text = document.getElementById("shopText");
  if (shopState.is_open) {
    pill.className = "shop-pill open";
    text.textContent = "Shop Open";
  } else {
    pill.className = "shop-pill closed";
    text.textContent = "Shop Closed";
  }
}

function bindShopToggle() {
  document.getElementById("shopPill").addEventListener("click", () => {
    document.getElementById("shopToggle").checked = shopState.is_open;
    document.getElementById("shopMessage").value  = shopState.closure_message || "";
    document.getElementById("shopReopen").value   = shopState.reopen_date || "";
    toggleClosureFields();
    openModal("shopModal");
  });

  document.getElementById("shopToggle").addEventListener("change", toggleClosureFields);
  document.getElementById("shopCancel").addEventListener("click", () => closeModal("shopModal"));

  document.getElementById("shopSave").addEventListener("click", async () => {
    const is_open = document.getElementById("shopToggle").checked;
    const body = {
      is_open,
      closure_message: document.getElementById("shopMessage").value,
      reopen_date:     document.getElementById("shopReopen").value || null,
    };
    try {
      const r = await fetch("/admin/salon/toggle", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const d = await r.json();
      if (d.success) {
        shopState = d.state;
        renderShopPill();
        closeModal("shopModal");
        toast(is_open ? "Shop is now open" : "Shop is now closed", "success");
      } else {
        toast(d.error || "Couldn't save", "error");
      }
    } catch (e) {
      toast("Network error", "error");
    }
  });
}

function toggleClosureFields() {
  const open = document.getElementById("shopToggle").checked;
  document.getElementById("closureFields").style.display = open ? "none" : "block";
}


// ── WALK-IN ─────────────────────────────────────────────────
function bindWalkin() {
  document.getElementById("btnWalkin").addEventListener("click", () => {
    document.getElementById("walkDate").value = state.date;
    document.getElementById("walkName").value  = "";
    document.getElementById("walkPhone").value = "";
    refreshWalkSlots(state.date);
    openModal("walkinModal");
  });

  document.getElementById("walkDate").addEventListener("change", e => refreshWalkSlots(e.target.value));
  document.getElementById("walkCancel").addEventListener("click", () => closeModal("walkinModal"));

  document.getElementById("walkSave").addEventListener("click", async () => {
    const body = {
      name:       document.getElementById("walkName").value,
      phone:      document.getElementById("walkPhone").value,
      service_id: document.getElementById("walkService").value,
      date:       document.getElementById("walkDate").value,
      time:       document.getElementById("walkTime").value,
    };
    if (!body.name || !body.phone || !body.time || body.time === "Pick date first") {
      return toast("Fill all fields", "error");
    }

    try {
      const r = await fetch("/admin/bookings/walkin", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const d = await r.json();
      if (d.success) {
        closeModal("walkinModal");
        toast(`Walk-in booked: ${body.name}`, "success");
        if (body.date === state.date) loadDate(state.date);
      } else {
        toast(d.error || "Couldn't book", "error");
      }
    } catch (e) {
      toast("Network error", "error");
    }
  });
}

async function refreshWalkSlots(dateStr) {
  const sel = document.getElementById("walkTime");
  if (!dateStr) { sel.innerHTML = "<option>Pick a date first</option>"; return; }
  try {
    const r = await fetch(`/slots?date=${dateStr}`);
    const d = await r.json();
    if (!d.success) { sel.innerHTML = "<option>No slots</option>"; return; }
    const open = d.slots.filter(s => s.available);
    sel.innerHTML = open.length === 0
      ? "<option>No open slots</option>"
      : open.map(s => `<option value="${s.time}">${s.label}</option>`).join("");
  } catch (e) {
    sel.innerHTML = "<option>Error loading</option>";
  }
}


// ── SEARCH ──────────────────────────────────────────────────
function bindSearch() {
  document.getElementById("btnSearch").addEventListener("click", () => {
    document.getElementById("searchInput").value = "";
    document.getElementById("searchResults").innerHTML =
      '<div class="empty" style="padding:32px">Start typing to search.</div>';
    openModal("searchModal");
    setTimeout(() => document.getElementById("searchInput").focus(), 100);
  });
  document.getElementById("searchClose").addEventListener("click", () => closeModal("searchModal"));

  let timer;
  document.getElementById("searchInput").addEventListener("input", e => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (q.length < 2) {
      document.getElementById("searchResults").innerHTML =
        '<div class="empty" style="padding:32px">Type at least 2 characters.</div>';
      return;
    }
    timer = setTimeout(() => runSearch(q), 250);
  });
}

async function runSearch(q) {
  const out = document.getElementById("searchResults");
  out.innerHTML = '<div class="empty" style="padding:32px">Searching…</div>';
  try {
    const r = await fetch(`/admin/bookings/search?q=${encodeURIComponent(q)}`);
    const d = await r.json();
    if (!d.success || d.results.length === 0) {
      out.innerHTML = '<div class="empty" style="padding:32px">No matches.</div>';
      return;
    }
    out.innerHTML = d.results.map(b => `
      <div class="search-result">
        <div class="sr-main">
          <div class="sr-name">${escape(b.name)}</div>
          <div class="sr-sub">${b.booking_id} · ${escape(b.service.name)} · ${b.phone}</div>
        </div>
        <div class="sr-date">${b.date} · ${b.time_label}</div>
        <div class="sr-status ${b.status}">${b.status}</div>
      </div>
    `).join("");
  } catch (e) {
    out.innerHTML = '<div class="empty" style="padding:32px">Search failed.</div>';
  }
}


// ── BARBERS ─────────────────────────────────────────────────
function bindBarberAdd() {
  document.getElementById("btnAddBarber").addEventListener("click", () => {
    document.getElementById("bName").value = "";
    document.getElementById("bUser").value = "";
    document.getElementById("bPass").value = "";
    openModal("barberModal");
  });
  document.getElementById("bCancel").addEventListener("click", () => closeModal("barberModal"));

  document.getElementById("bSave").addEventListener("click", async () => {
    const body = {
      name:     document.getElementById("bName").value,
      username: document.getElementById("bUser").value.toLowerCase().trim(),
      password: document.getElementById("bPass").value,
    };
    if (!body.name || !body.username || !body.password) return toast("Fill all fields", "error");

    try {
      const r = await fetch("/admin/barbers", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });

      // If we got redirected to login, our session is gone
      if (r.redirected && r.url.includes("/admin/login")) {
        toast("Session expired — log in again", "error");
        setTimeout(() => window.location.href = "/admin/login", 1200);
        return;
      }

      // Try to read response as JSON, fall back to text for diagnostics
      const text = await r.text();
      let d = {};
      try { d = JSON.parse(text); }
      catch (parseErr) {
        console.error("Server returned non-JSON. Status:", r.status, "Body:", text.slice(0, 200));
        toast(`Server returned ${r.status} — check the console`, "error");
        return;
      }

      if (d.success) {
        closeModal("barberModal");
        toast(`${body.name} added`, "success");
        loadBarbers();
      } else {
        toast(d.error || `Server error (${r.status})`, "error");
      }
    } catch (e) {
      console.error("Barber create failed:", e);
      toast("Could not reach server: " + e.message, "error");
    }
  });
}

async function loadBarbers() {
  const grid = document.getElementById("barberGrid");
  try {
    const r = await fetch("/admin/barbers");
    const d = await r.json();
    if (!d.success) { grid.innerHTML = '<div class="empty">Could not load barbers.</div>'; return; }
    if (d.barbers.length === 0) {
      grid.innerHTML = '<div class="empty">No barbers yet. Add one to get started.</div>';
      return;
    }
    grid.innerHTML = d.barbers.map(b => {
      const s = b.stats;
      const working = s.is_clocked_in;
      const stars = s.avg_rating > 0
        ? "★".repeat(Math.round(s.avg_rating)) + "☆".repeat(5 - Math.round(s.avg_rating))
        : "—";
      return `
        <article class="barber">
          <div class="barber-head">
            <div class="barber-avatar">${initials(b.name)}</div>
            <div class="barber-meta">
              <div class="barber-name">${escape(b.name)}</div>
              <div class="barber-user">@${escape(b.username)}</div>
            </div>
            <div class="barber-status ${working ? "working" : "off"}">${working ? "Working" : "Off"}</div>
          </div>

          <div class="barber-stats">
            <div class="barber-stat"><div class="v">${s.today_hours}h</div><div class="l">Today</div></div>
            <div class="barber-stat"><div class="v">${s.week_hours}h</div><div class="l">This Week</div></div>
            <div class="barber-stat"><div class="v">${s.month_hours}h</div><div class="l">This Month</div></div>
            <div class="barber-stat"><div class="v">${s.rating_count}</div><div class="l">Ratings</div></div>
          </div>

          <div class="barber-foot">
            <div class="barber-stars">
              <span class="stars">${stars}</span>
              <span class="count">${s.avg_rating > 0 ? s.avg_rating + " avg" : "no ratings yet"}</span>
            </div>
            <button class="btn-x" onclick="removeBarber(${b.id}, '${escape(b.name)}')" title="Remove">×</button>
          </div>
        </article>
      `;
    }).join("");
  } catch (e) {
    grid.innerHTML = '<div class="empty">A line went quiet.</div>';
  }
}

async function removeBarber(id, name) {
  // re-use existing dialog
  pendingCancel = "barber-" + id;
  document.getElementById("dlgTitle").textContent = "Remove barber?";
  document.getElementById("dlgMsg").innerHTML =
    `<strong>${name}</strong> will be removed permanently along with their clock-in history and ratings.`;
  document.getElementById("dialogVeil").classList.add("show");

  const okBtn = document.getElementById("dlgOk");
  const newOk = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newOk, okBtn);
  newOk.addEventListener("click", async () => {
    closeDialog();
    try {
      const r = await fetch(`/admin/barbers/${id}`, { method: "DELETE" });
      const d = await r.json();
      if (d.success) { toast(`${name} removed`, "success"); loadBarbers(); }
      else { toast(d.error || "Couldn't remove", "error"); }
    } catch (e) {
      toast("Network error", "error");
    }
  });
}


// ============================================================
// ANALYTICS + CSV EXPORT
// ============================================================

let analyticsDays = 30;

document.addEventListener("DOMContentLoaded", () => {
  loadAnalytics();
  bindAnalytics();
  bindExport();
});

function bindAnalytics() {
  document.querySelectorAll(".period-pill").forEach(p => {
    p.addEventListener("click", () => {
      document.querySelectorAll(".period-pill").forEach(x => x.classList.remove("active"));
      p.classList.add("active");
      analyticsDays = parseInt(p.dataset.d);
      loadAnalytics();
    });
  });
}

async function loadAnalytics() {
  // Reset displays to loading
  document.getElementById("anaServices").innerHTML = '<div class="empty" style="padding:20px 0">Loading…</div>';
  document.getElementById("anaHours").innerHTML    = '<div class="empty" style="padding:20px 0">Loading…</div>';
  document.getElementById("anaDays").innerHTML     = '<div class="empty" style="padding:20px 0">Loading…</div>';

  try {
    const [svcRes, peakRes] = await Promise.all([
      fetch(`/admin/analytics/services?days=${analyticsDays}`).then(r => r.json()),
      fetch(`/admin/analytics/peak?days=${analyticsDays}`).then(r => r.json()),
    ]);

    if (svcRes.success)  renderServices(svcRes);
    if (peakRes.success) renderPeak(peakRes);

    // KPIs
    if (svcRes.success) {
      document.getElementById("aBookings").textContent = svcRes.total_bookings.toLocaleString();
      document.getElementById("aRevenue").textContent  = "Rs. " + Math.round(svcRes.total_revenue / 1000) + "k";
      animateCounter("aBookings", svcRes.total_bookings, n => n.toLocaleString());
    }
    if (peakRes.success) {
      document.getElementById("aPeakHour").textContent = peakRes.peak_hour ? peakRes.peak_hour.label.trim() : "—";
      document.getElementById("aPeakDay").textContent  = peakRes.peak_day  ? peakRes.peak_day.label  : "—";
    }
  } catch (e) {
    toast("Could not load analytics", "error");
  }
}

function animateCounter(id, target, fmt) {
  const el = document.getElementById(id);
  const start = 0;
  const dur = 600;
  const t0 = performance.now();
  function step(t) {
    const k = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    const cur = Math.round(start + (target - start) * eased);
    el.textContent = fmt ? fmt(cur) : cur;
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function renderServices(d) {
  const out = document.getElementById("anaServices");
  if (!d.services || d.services.length === 0) {
    out.innerHTML = '<div class="empty" style="padding:20px 0">No data in this period.</div>';
    return;
  }
  const max = Math.max(...d.services.map(s => s.count));
  const tones = ["", "alt", "alt2"];
  out.innerHTML = d.services.map((s, i) => `
    <div class="ana-svc">
      <div class="ana-svc-name">${escape(s.name)}</div>
      <div class="ana-svc-meta">${s.count} · Rs. ${s.revenue.toLocaleString()} · ${s.percent}%</div>
      <div class="ana-svc-bar">
        <div class="ana-svc-bar-fill ${tones[i % 3]}" data-w="${(s.count / max) * 100}"></div>
      </div>
    </div>
  `).join("");
  // animate bars in
  requestAnimationFrame(() => {
    out.querySelectorAll(".ana-svc-bar-fill").forEach((el, i) => {
      setTimeout(() => { el.style.width = el.dataset.w + "%"; }, i * 80);
    });
  });
}

function renderPeak(d) {
  // Hours
  const hoursOut = document.getElementById("anaHours");
  if (!d.hours || d.hours.length === 0 || d.total === 0) {
    hoursOut.innerHTML = '<div class="empty" style="padding:20px 0">No data in this period.</div>';
  } else {
    const maxH = Math.max(...d.hours.map(h => h.count)) || 1;
    const peakH = d.peak_hour ? d.peak_hour.hour : -1;
    // condense: show every 2 hours for space
    const condensed = d.hours.filter((_, i) => i % 2 === 0 || d.hours[i].hour === peakH);
    hoursOut.innerHTML = condensed.map(h => {
      const isPeak = h.hour === peakH;
      const pct = (h.count / maxH) * 100;
      return `
        <div class="ana-bar">
          <span class="ana-bar-count">${h.count}</span>
          <div class="ana-bar-fill ${isPeak ? "peak" : ""}" data-h="${pct}"></div>
          <span class="ana-bar-label">${h.hour}${h.hour >= 12 ? "p" : "a"}</span>
        </div>
      `;
    }).join("");
    requestAnimationFrame(() => {
      hoursOut.querySelectorAll(".ana-bar-fill").forEach((el, i) => {
        setTimeout(() => { el.style.height = el.dataset.h + "%"; }, i * 50);
      });
    });
  }

  // Days
  const daysOut = document.getElementById("anaDays");
  if (!d.weekdays || d.total === 0) {
    daysOut.innerHTML = '<div class="empty" style="padding:20px 0">No data in this period.</div>';
  } else {
    const maxD = Math.max(...d.weekdays.map(w => w.count)) || 1;
    const peakD = d.peak_day ? d.peak_day.day : -1;
    daysOut.innerHTML = d.weekdays.map(w => {
      const isPeak = w.day === peakD;
      const pct = (w.count / maxD) * 100;
      return `
        <div class="ana-bar">
          <span class="ana-bar-count">${w.count}</span>
          <div class="ana-bar-fill ${isPeak ? "peak" : ""}" data-h="${pct}"></div>
          <span class="ana-bar-label">${w.label}</span>
        </div>
      `;
    }).join("");
    requestAnimationFrame(() => {
      daysOut.querySelectorAll(".ana-bar-fill").forEach((el, i) => {
        setTimeout(() => { el.style.height = el.dataset.h + "%"; }, i * 60);
      });
    });
  }
}


// ── CSV EXPORT ──────────────────────────────────────────────
function bindExport() {
  document.getElementById("btnExport").addEventListener("click", () => {
    // Default to last 30 days
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 30);
    document.getElementById("expStart").value = start.toISOString().slice(0, 10);
    document.getElementById("expEnd").value   = end.toISOString().slice(0, 10);
    openModal("exportModal");
  });
  document.getElementById("expCancel").addEventListener("click", () => closeModal("exportModal"));

  document.getElementById("expDownload").addEventListener("click", () => {
    const start = document.getElementById("expStart").value;
    const end   = document.getElementById("expEnd").value;
    if (!start || !end) return toast("Pick both dates", "error");
    if (start > end) return toast("Start must be before end", "error");

    // Trigger download by navigating; Flask responds with CSV attachment
    const url = `/admin/export?start=${start}&end=${end}`;
    window.location.href = url;
    closeModal("exportModal");
    toast("CSV download starting…", "success");
  });
}