// ============================================================
// GLOBAL HAIR SALOON — Customer Site
// ============================================================

// ╔══════════════════════════════════════════════════════════╗
// ║  PARTICLE BACKGROUND — floating barber atmosphere          ║
// ║  Dust dots + slowly tumbling scissors & combs              ║
// ╚══════════════════════════════════════════════════════════╝
(function initParticles() {
  const canvas = document.getElementById("bgCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: true });

  let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);
  let particles = [];
  let mouse = { x: -9999, y: -9999, active: false };
  let t0 = performance.now();

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width  = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width  = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    seed();
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  function seed() {
    const total = Math.min(360, Math.floor((W * H) / 5500));
    particles = [];

    // ── 90% dust dots — varied depth tiers ─────────────────
    const dustCount = Math.floor(total * 0.9);
    for (let i = 0; i < dustCount; i++) {
      const tier = Math.random();
      let depth, radius, speed;
      if (tier < 0.62) {
        depth = rand(0.25, 0.5);
        radius = rand(0.4, 1.0);
        speed = rand(0.04, 0.14);
      } else {
        depth = rand(0.5, 0.85);
        radius = rand(0.8, 1.5);
        speed = rand(0.08, 0.20);
      }
      const angle = Math.random() * Math.PI * 2;
      particles.push({
        type: "dust",
        x: Math.random() * W,
        y: Math.random() * H,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: radius,
        d: depth,
        twinkle: Math.random() * Math.PI * 2,
        twinkleSpeed: rand(0.008, 0.022),
        hue: rand(215, 240),
      });
    }

    // ── 13% barber tools — slowly tumbling silhouettes ─────
    // Mix of 5 tools, scissors and comb biased a bit more common
    const kinds = ["scissors", "scissors", "comb", "comb", "razor", "clipper", "brush"];
    const toolCount = Math.max(14, Math.floor(total * 0.13));
    for (let i = 0; i < toolCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = rand(0.25, 0.5);
      particles.push({
        type: "tool",
        kind: kinds[Math.floor(Math.random() * kinds.length)],
        x: Math.random() * W,
        y: Math.random() * H,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: rand(18, 28),
        d: rand(0.65, 1),
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: rand(-0.0035, 0.0035),
        twinkle: Math.random() * Math.PI * 2,
        twinkleSpeed: rand(0.006, 0.014),
        hue: rand(218, 232),
      });
    }
  }

  // ── tool drawing primitives ──────────────────────────────
  function drawScissors(s) {
    // handles
    ctx.beginPath();
    ctx.arc(-s * 0.35, -s * 0.28, s * 0.14, 0, Math.PI * 2);
    ctx.moveTo(-s * 0.21, s * 0.28);
    ctx.arc(-s * 0.35, s * 0.28, s * 0.14, 0, Math.PI * 2);
    ctx.stroke();
    // crossing blades
    ctx.beginPath();
    ctx.moveTo(-s * 0.22, -s * 0.18);
    ctx.lineTo(s * 0.48, s * 0.42);
    ctx.moveTo(-s * 0.22, s * 0.18);
    ctx.lineTo(s * 0.48, -s * 0.42);
    ctx.stroke();
    // pivot dot
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(s * 0.06, 0, s * 0.04, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawComb(s) {
    // spine
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, -s * 0.05);
    ctx.lineTo(s * 0.5, -s * 0.05);
    ctx.stroke();
    // teeth (6 of them, dropping down from spine)
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const tx = -s * 0.5 + (s * i / 6);
      ctx.moveTo(tx, -s * 0.05);
      ctx.lineTo(tx, s * 0.32);
    }
    ctx.stroke();
  }

  function drawTool(p, alpha) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);

    // soft glow halo behind the tool — tighter so it doesn't wash out the lines
    const haloR = p.size * 0.95;
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, haloR);
    halo.addColorStop(0, `hsla(${p.hue}, 90%, 72%, ${alpha * 0.16})`);
    halo.addColorStop(1, `hsla(${p.hue}, 90%, 72%, 0)`);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, haloR, 0, Math.PI * 2);
    ctx.fill();

    // the tool itself — heavier stroke, fully opaque so it stays crisp
    ctx.strokeStyle = `hsla(${p.hue}, 85%, 82%, ${Math.max(0.55, alpha)})`;
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (p.kind === "scissors") drawScissors(p.size);
    else if (p.kind === "comb") drawComb(p.size);

    ctx.restore();
  }

  function step() {
    const now = performance.now();
    const dt = Math.min(2, (now - t0) / 16.6667);
    t0 = now;

    ctx.clearRect(0, 0, W, H);

    // ── constellation lines — only between dust dots (mid+) ─
    const maxDist = 100;
    const maxDist2 = maxDist * maxDist;
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      if (a.type !== "dust" || a.d < 0.5) continue;
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        if (b.type !== "dust" || b.d < 0.5) continue;
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < maxDist2) {
          const alpha = (1 - d2 / maxDist2) * 0.16 * a.d * b.d;
          ctx.strokeStyle = `rgba(95, 130, 240, ${alpha})`;
          ctx.lineWidth = 0.55;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    // ── update + draw every particle ───────────────────────
    for (const p of particles) {
      // tiny random gust = freeform drift
      p.vx += (Math.random() - 0.5) * 0.006;
      p.vy += (Math.random() - 0.5) * 0.006;

      // mouse pull
      if (mouse.active) {
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 160 * 160) {
          const dist = Math.sqrt(d2) || 1;
          const f = (1 - dist / 160) * 0.05 * p.d;
          p.vx += (dx / dist) * f;
          p.vy += (dy / dist) * f;
        }
      }

      // friction — tools drift freely (light friction), dust settles more
      if (p.type === "tool") {
        p.vx *= 0.998;
        p.vy *= 0.998;

        // enforce minimum drift speed so tools never come to a halt
        const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (sp < 0.18) {
          const a = Math.atan2(p.vy, p.vx);
          p.vx = Math.cos(a) * 0.18;
          p.vy = Math.sin(a) * 0.18;
        }
      } else {
        p.vx *= 0.985;
        p.vy *= 0.985;
      }
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;

      // wrap
      if (p.x < -30) p.x = W + 30;
      if (p.x > W + 30) p.x = -30;
      if (p.y < -30) p.y = H + 30;
      if (p.y > H + 30) p.y = -30;

      // twinkle
      p.twinkle += p.twinkleSpeed * dt;
      const twinkle = 0.7 + Math.sin(p.twinkle) * 0.3;

      if (p.type === "dust") {
        const alpha = (0.55 * p.d + 0.18) * twinkle;
        ctx.fillStyle = `hsla(${p.hue}, 75%, 72%, ${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // tool — slow rotation + draw
        p.rotation += p.rotationSpeed * dt;
        const alpha = (0.55 * p.d + 0.2) * twinkle;
        drawTool(p, alpha);
      }
    }

    requestAnimationFrame(step);
  }

  window.addEventListener("resize", () => {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    resize();
  });
  window.addEventListener("mousemove", e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
  });
  window.addEventListener("mouseout", () => { mouse.active = false; });

  resize();
  requestAnimationFrame(step);
})();


// ╔══════════════════════════════════════════════════════════╗
// ║  CURSOR-GLOW TEXT — every prominent text element lights    ║
// ║  up where the cursor is near                              ║
// ╚══════════════════════════════════════════════════════════╝
function setupTitleGlow() {
  // Every major piece of display text on the page (text only, no buttons/links)
  const selectors = [
    ".hero-title", ".hero-sub", ".hero-eyebrow",
    ".meta-num", ".meta-label",
    ".section-title", ".eyebrow",
    ".service-name", ".service-price", ".service-num",
    ".visit-label", ".vp-label",
    ".step-label", ".conf-sub",
    ".featured-tag",
    ".footer-meta",
  ];

  const letters = [];

  // Recursively wrap each non-space text character in a <span class="letter">.
  // Skip SVGs, the rating star (it has its own glow), and existing .letter spans.
  function wrap(el) {
    if (!el) return;
    if (el.tagName === "SVG" || el.tagName === "svg") return;
    if (el.classList && (el.classList.contains("rating-star") || el.classList.contains("letter"))) return;

    const kids = [...el.childNodes];
    kids.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        if (!text || !text.trim()) return;
        const frag = document.createDocumentFragment();
        for (const ch of text) {
          if (ch === " " || ch === "\u00A0" || ch === "\n" || ch === "\t") {
            frag.appendChild(document.createTextNode(ch));
          } else {
            const letter = document.createElement("span");
            letter.className = "letter";
            letter.textContent = ch;
            frag.appendChild(letter);
            letters.push(letter);
          }
        }
        node.parentNode.replaceChild(frag, node);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        wrap(node);
      }
    });
  }

  selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(wrap);
  });

  if (letters.length === 0) return;

  // Cache letter center positions — recompute on resize / scroll / fonts loading
  let positions = [];
  function cachePositions() {
    positions = letters.map(l => {
      const r = l.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
  }
  cachePositions();
  window.addEventListener("resize", cachePositions);
  window.addEventListener("scroll", cachePositions, { passive: true });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(cachePositions);
  }

  // Track cursor, throttle updates with rAF
  let mx = -9999, my = -9999, queued = false;
  const RADIUS = 180; // glow falls off past this distance

  function update() {
    queued = false;
    for (let i = 0; i < letters.length; i++) {
      const p = positions[i];
      if (!p) continue;
      const dx = mx - p.x;
      const dy = my - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // smooth quadratic falloff — feels nicer than linear
      const t = Math.max(0, 1 - dist / RADIUS);
      const glow = t * t;
      letters[i].style.setProperty("--glow", glow.toFixed(3));
    }
  }

  window.addEventListener("mousemove", e => {
    mx = e.clientX;
    my = e.clientY;
    if (!queued) { queued = true; requestAnimationFrame(update); }
  });
  window.addEventListener("mouseout", () => {
    mx = -9999; my = -9999;
    if (!queued) { queued = true; requestAnimationFrame(update); }
  });
}


const state = {
  service:      null,
  servicePrice: 0,
  barber:       null,   // {id, name}
  date:         null,
  time:         null,
  time_label:   null,
};


document.addEventListener("DOMContentLoaded", () => {

  // Year stamp in footer
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Logo → smooth scroll to top
  const logoBtn = document.getElementById("logoBtn");
  if (logoBtn) {
    logoBtn.addEventListener("click", e => {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // Cursor-glow on hero title letters
  setupTitleGlow();

  // Check shop status (show closed banner if needed)
  checkShopStatus();

  // Set min date on the picker to today
  const dateInput = document.getElementById("bookDate");
  if (dateInput) {
    const today = new Date().toISOString().split("T")[0];
    dateInput.min = today;
  }

  wireServiceCards();
  wireServiceOptions();
  wireDatePicker();
  wireSubmit();
  wireReset();
  loadBarbers();
});


// ── BARBER SELECTION (booking step 02) ────────────────────
async function loadBarbers() {
  const grid = document.getElementById("barbersGrid");
  if (!grid) return;
  try {
    const r = await fetch("/barbers");
    const d = await r.json();
    if (!d.success || !d.barbers || d.barbers.length === 0) {
      grid.innerHTML = '<div class="barbers-empty">No barbers available right now. Please call the salon to book.</div>';
      return;
    }
    renderBarbers(d.barbers);
  } catch (e) {
    grid.innerHTML = '<div class="barbers-empty">Could not load barbers. Try refreshing.</div>';
  }
}

function renderBarbers(barbers) {
  const grid = document.getElementById("barbersGrid");
  grid.innerHTML = barbers.map(b => {
    const initials = b.name.split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join("").toUpperCase() || "?";
    let ratingHtml;
    if (b.rating_count > 0) {
      const filled = Math.round(b.avg_rating);
      const stars  = "★".repeat(filled) + "☆".repeat(5 - filled);
      ratingHtml = `<span class="stars">${stars}</span> ${b.avg_rating} <span style="color:var(--text-mute)">(${b.rating_count})</span>`;
    } else {
      ratingHtml = `<span style="color:var(--text-mute)">New barber</span>`;
    }
    return `
      <button type="button" class="barber-option" data-barber-id="${b.id}" data-barber-name="${escapeHtml(b.name)}">
        <div class="barber-avatar">${escapeHtml(initials)}</div>
        <div class="barber-option-info">
          <div class="barber-option-name">${escapeHtml(b.name)}</div>
          <div class="barber-option-rating">${ratingHtml}</div>
        </div>
      </button>
    `;
  }).join("");

  grid.querySelectorAll(".barber-option").forEach(btn => {
    btn.addEventListener("click", () => {
      grid.querySelectorAll(".barber-option").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      state.barber = {
        id:   parseInt(btn.dataset.barberId),
        name: btn.dataset.barberName,
      };
    });
  });
}


// ── SHOP STATUS ─────────────────────────────────────────────
async function checkShopStatus() {
  try {
    const res = await fetch("/salon/status");
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success || !data.state) return;
    if (!data.state.is_open) showClosedOverlay(data.state);
  } catch (e) {
    // status endpoint not available — assume open
    console.debug("Status check skipped:", e.message);
  }
}


function showClosedOverlay(st) {
  const overlay = document.getElementById("closedOverlay");
  const msgEl   = document.getElementById("closedOverlayMessage");
  const reopen  = document.getElementById("closedOverlayReopen");
  if (!overlay) return;

  msgEl.textContent = st.closure_message
    || "We're not accepting bookings right now. Please check back soon.";

  if (st.reopen_date) {
    const d = new Date(st.reopen_date + "T00:00:00")
      .toLocaleDateString("en-PK", { weekday: "long", month: "long", day: "numeric" });
    reopen.textContent = `Reopening ${d}`;
    reopen.style.display = "inline-flex";
  } else {
    reopen.style.display = "none";
  }

  overlay.style.display = "flex";
  document.body.classList.add("is-closed");
}


// ── SERVICE CARDS (in Services section) ────────────────────
function wireServiceCards() {
  document.querySelectorAll(".service-card[data-service]").forEach(card => {
    card.addEventListener("click", () => {
      const serviceId = card.dataset.service;
      const opt = document.querySelector(`.service-option[data-service="${serviceId}"]`);
      if (opt) {
        document.querySelectorAll(".service-option").forEach(b => b.classList.remove("selected"));
        opt.classList.add("selected");
        state.service      = opt.dataset.service;
        state.servicePrice = parseInt(opt.dataset.price) || 0;
      }
      const bookSection = document.getElementById("book");
      if (bookSection) bookSection.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}


// ── SERVICE OPTIONS (in booking flow) ──────────────────────
function wireServiceOptions() {
  document.querySelectorAll(".service-option").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".service-option").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      state.service      = btn.dataset.service;
      state.servicePrice = parseInt(btn.dataset.price) || 0;
    });
  });
}


// ── DATE PICKER ────────────────────────────────────────────
function wireDatePicker() {
  const dateInput = document.getElementById("bookDate");
  if (!dateInput) return;

  dateInput.addEventListener("change", () => {
    state.date       = dateInput.value;
    state.time       = null;
    state.time_label = null;
    if (state.date) loadSlots(state.date);
  });
}


async function loadSlots(date) {
  const grid = document.getElementById("slotsGrid");
  grid.innerHTML = '<div class="slots-empty">Loading available times…</div>';

  try {
    const res  = await fetch(`/slots?date=${encodeURIComponent(date)}`);
    const data = await res.json();

    if (!data.success) {
      grid.innerHTML = `<div class="slots-empty">${escapeHtml(data.error || "Could not load slots.")}</div>`;
      return;
    }
    if (!data.slots || data.slots.length === 0) {
      grid.innerHTML = '<div class="slots-empty">No slots for this date.</div>';
      return;
    }

    grid.innerHTML = data.slots.map(s => `
      <button type="button"
              class="slot-btn"
              data-time="${s.time}"
              data-label="${s.label}"
              ${s.available ? "" : "disabled"}>
        ${s.label}
      </button>
    `).join("");

    grid.querySelectorAll(".slot-btn:not(:disabled)").forEach(btn => {
      btn.addEventListener("click", () => {
        grid.querySelectorAll(".slot-btn").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        state.time       = btn.dataset.time;
        state.time_label = btn.dataset.label;
      });
    });

  } catch (e) {
    grid.innerHTML = '<div class="slots-empty">Network error — please try again.</div>';
  }
}


// ── SUBMIT ──────────────────────────────────────────────────
function wireSubmit() {
  const btn = document.getElementById("btnBook");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const name  = document.getElementById("bookName").value.trim();
    const phone = document.getElementById("bookPhone").value.trim();
    hideError();

    if (!state.service) return showError("Please pick a service.");
    if (!state.barber)  return showError("Please choose your barber.");
    if (!state.date)    return showError("Please pick a date.");
    if (!state.time)    return showError("Please pick a time slot.");
    if (!name)          return showError("Please enter your name.");
    if (!phone)         return showError("Please enter your phone number.");

    btn.disabled    = true;
    btn.textContent = "Booking…";

    try {
      const res = await fetch("/bookings", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, phone,
          service_id: state.service,
          barber_id:  state.barber.id,
          date:       state.date,
          time:       state.time,
        }),
      });
      const data = await res.json();

      if (data.success) {
        toast("Booking confirmed — see you soon!", "success");
        showConfirmation(data.booking);
      } else {
        showError(data.error || "Could not complete booking.");
        btn.disabled    = false;
        btn.textContent = "Confirm Booking";
      }
    } catch (e) {
      showError("Network error — please try again.");
      btn.disabled    = false;
      btn.textContent = "Confirm Booking";
    }
  });
}


function showError(msg) {
  const box = document.getElementById("bookError");
  box.textContent     = msg;
  box.style.display   = "flex";
  box.scrollIntoView({ behavior: "smooth", block: "center" });
}

function hideError() {
  const box = document.getElementById("bookError");
  if (box) box.style.display = "none";
}


// ── CONFIRMATION ────────────────────────────────────────────
function showConfirmation(booking) {
  document.getElementById("bookingFlow").style.display  = "none";
  document.getElementById("confirmation").style.display = "block";

  document.getElementById("confirmDetails").innerHTML = `
    <div class="conf-row"><span>Booking ID</span><strong>${booking.booking_id}</strong></div>
    <div class="conf-row"><span>Name</span><strong>${escapeHtml(booking.name)}</strong></div>
    <div class="conf-row"><span>Service</span><strong>${escapeHtml(booking.service.name)}</strong></div>
    ${booking.barber ? `<div class="conf-row"><span>Barber</span><strong>${escapeHtml(booking.barber.name)}</strong></div>` : ""}
    <div class="conf-row"><span>Date</span><strong>${booking.date}</strong></div>
    <div class="conf-row"><span>Time</span><strong>${booking.time_label}</strong></div>
    <div class="conf-row"><span>Total</span><strong>Rs. ${booking.service.price}</strong></div>
  `;

  // Inject rating link into the confirmation
  const ratingLink = document.getElementById("ratingLink");
  if (ratingLink) {
    ratingLink.href = `/rate/${booking.booking_id}`;
    ratingLink.style.display = "inline-flex";
  }

  document.getElementById("confirmation").scrollIntoView({ behavior: "smooth", block: "start" });
}


function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}


// ── RESET ───────────────────────────────────────────────────
function wireReset() {
  const btn = document.getElementById("btnReset");
  if (!btn) return;

  btn.addEventListener("click", () => {
    state.service      = null;
    state.servicePrice = 0;
    state.barber       = null;
    state.date         = null;
    state.time         = null;
    state.time_label   = null;

    document.querySelectorAll(".service-option").forEach(b => b.classList.remove("selected"));
    document.querySelectorAll(".barber-option").forEach(b => b.classList.remove("selected"));
    document.getElementById("bookDate").value  = "";
    document.getElementById("bookName").value  = "";
    document.getElementById("bookPhone").value = "";
    document.getElementById("slotsGrid").innerHTML =
      '<div class="slots-empty">Pick a date to see available times.</div>';
    hideError();

    document.getElementById("confirmation").style.display = "none";
    document.getElementById("bookingFlow").style.display  = "flex";

    const submit = document.getElementById("btnBook");
    submit.disabled    = false;
    submit.textContent = "Confirm Booking";

    document.getElementById("book").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}


// ── TOAST ───────────────────────────────────────────────────
function toast(msg, type = "info") {
  const stack = document.getElementById("toastStack");
  if (!stack) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 320);
  }, 3500);
}