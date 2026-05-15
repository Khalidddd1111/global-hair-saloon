// ============================================================
// GLOBAL HAIR SALOON — Public Site JS
// ============================================================

const SERVICES = {
  haircut:           { name: "Haircut",         price: 500, duration: 45 },
  beard:             { name: "Beard",           price: 300, duration: 45 },
  haircut_and_beard: { name: "Haircut + Beard", price: 800, duration: 45 },
};

const state = {
  service:    null,
  date:       null,
  time:       null,
  time_label: null,
  name:       "",
  phone:      "",
};

// ─── DOM REFS ────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const stickyBar     = $("stickyBar");
const sumService    = $("sumService");
const sumSep        = $("sumSep");
const sumTime       = $("sumTime");
const sumPrice      = $("sumPrice");
const confirmBtn    = $("confirmBtn");
const bookingError  = $("bookingError");
const slotsGrid     = $("slotsGrid");
const dateInput     = $("bookDate");
const nameInput     = $("bookName");
const phoneInput    = $("bookPhone");
const modal         = $("successModal");
const modalClose    = $("modalClose");

// ─── HELPERS USED EARLY ──────────────────────────────────────
function getLocalDateStr(d = new Date()) {
  // Build YYYY-MM-DD from LOCAL time, not UTC.
  // (toISOString() returns UTC and rolls to "tomorrow" after ~7 PM PKT.)
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ─── INIT ────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Use local time so "today" is correct in Pakistan even after 7 PM
  const today = getLocalDateStr();
  dateInput.min   = today;
  dateInput.value = today;

  // Setting .value via JS does NOT fire 'change' — load today's slots manually.
  state.date = today;
  loadSlots(today);

  // Service selection — both in services section AND in step 1
  document.querySelectorAll("[data-service]").forEach((el) => {
    if (el.tagName === "BUTTON" || el.classList.contains("service-pick") || el.classList.contains("service-opt")) {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const id = el.dataset.service;
        selectService(id);

        // If clicked from services section, scroll to booking
        if (el.classList.contains("service-pick")) {
          document.getElementById("book").scrollIntoView({ behavior: "smooth" });
        }
      });
    }
  });

  // Date change
  dateInput.addEventListener("change", () => {
    state.date = dateInput.value;
    state.time = null;
    state.time_label = null;
    if (state.date) loadSlots(state.date);
    updateUI();
  });

  // Name + phone
  nameInput.addEventListener("input",  () => { state.name  = nameInput.value;  updateUI(); });
  phoneInput.addEventListener("input", () => { state.phone = phoneInput.value; updateUI(); });

  // Confirm
  confirmBtn.addEventListener("click", submitBooking);

  // Modal close
  modalClose.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  // Show sticky bar on scroll past hero (mobile-friendly trigger)
  const hero = document.querySelector(".hero");
  if (hero && "IntersectionObserver" in window) {
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        stickyBar.classList.remove("visible");
      } else {
        stickyBar.classList.add("visible");
      }
    }, { threshold: 0.1 });
    obs.observe(hero);
  } else {
    stickyBar.classList.add("visible");
  }

  // Booking lookup
  initLookup();

  // Initial UI sync
  updateUI();
});


// ─── SELECT SERVICE ──────────────────────────────────────────
function selectService(id) {
  if (!SERVICES[id]) return;
  state.service = id;

  // Mark selected in step 1
  document.querySelectorAll(".service-opt").forEach((b) => {
    b.classList.toggle("selected", b.dataset.service === id);
  });

  updateUI();
}


// ─── LOAD SLOTS ──────────────────────────────────────────────
async function loadSlots(date) {
  slotsGrid.innerHTML = '<div class="slots-loading">Loading slots...</div>';

  try {
    const res = await fetch(`/slots?date=${date}`);
    const data = await res.json();

    if (!data.success) {
      slotsGrid.innerHTML = `<div class="slots-empty">${escapeHtml(data.error || "Could not load slots.")}</div>`;
      return;
    }

    if (!data.slots || data.slots.length === 0) {
      slotsGrid.innerHTML = '<div class="slots-empty">No slots available for this date.</div>';
      return;
    }

    const todayStr = getLocalDateStr();
    const isToday = date === todayStr;
    const availableCount = data.slots.filter((s) => s.available).length;

    const banner = isToday
      ? `<div class="slots-banner today">
           <span class="slots-banner-dot"></span>
           Same-day booking — ${availableCount} slot${availableCount !== 1 ? "s" : ""} left today
         </div>`
      : `<div class="slots-banner">
           ${availableCount} of ${data.slots.length} slots available
         </div>`;

    slotsGrid.innerHTML = banner + data.slots.map((s) => `
      <button
        type="button"
        class="slot-btn ${s.available ? "" : "disabled"}"
        data-time="${s.time}"
        data-label="${s.label}"
        ${s.available ? "" : "disabled"}>
        ${s.label}
      </button>
    `).join("");

    // Attach click handlers
    slotsGrid.querySelectorAll(".slot-btn:not(.disabled)").forEach((btn) => {
      btn.addEventListener("click", () => {
        slotsGrid.querySelectorAll(".slot-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        state.time       = btn.dataset.time;
        state.time_label = btn.dataset.label;
        updateUI();
      });
    });

  } catch (e) {
    slotsGrid.innerHTML = `<div class="slots-empty">Network error. Please try again.</div>`;
  }
}


// ─── UPDATE UI (steps + sticky bar) ──────────────────────────
function updateUI() {
  const steps = ["step1", "step2", "step3", "step4"];
  const conditions = [
    true,                                // step 1 always active
    !!state.service,                     // step 2 unlocks after service
    !!state.service && !!state.date,     // step 3 unlocks after date
    !!state.service && !!state.date && !!state.time, // step 4 unlocks after time
  ];

  steps.forEach((id, i) => {
    const el = $(id);
    if (!el) return;
    el.classList.toggle("active",    conditions[i]);
    el.classList.toggle("completed", conditions[i + 1] || (i === 3 && allFilled()));
  });

  // Sticky bar
  if (state.service) {
    sumService.textContent = SERVICES[state.service].name;
    sumPrice.textContent   = `Rs. ${SERVICES[state.service].price}`;
  } else {
    sumService.textContent = "Choose a service";
    sumPrice.textContent   = "Rs. 0";
  }

  if (state.time_label) {
    sumTime.textContent = state.time_label;
    sumSep.hidden = false;
  } else {
    sumTime.textContent = "";
    sumSep.hidden = true;
  }

  // Confirm button
  confirmBtn.disabled = !allFilled();

  // Clear error if user adjusts state
  hideError();
}

function allFilled() {
  return !!(
    state.service &&
    state.date &&
    state.time &&
    state.name.trim().length >= 2 &&
    isValidPhone(state.phone)
  );
}

function isValidPhone(p) {
  const digits = (p || "").replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}


// ─── SUBMIT BOOKING ──────────────────────────────────────────
async function submitBooking() {
  if (!allFilled()) return;
  if (confirmBtn.classList.contains("loading")) return;

  hideError();
  confirmBtn.classList.add("loading");
  confirmBtn.querySelector("span").textContent = "Sending";

  try {
    const res = await fetch("/bookings", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        name:       state.name.trim(),
        phone:      state.phone.trim(),
        service_id: state.service,
        date:       state.date,
        time:       state.time,
      }),
    });

    const data = await res.json();

    if (!data.success) {
      showError(data.error || "Could not complete booking. Please try again.");
      resetConfirmBtn();
      return;
    }

    showSuccess(data.booking);
    resetForm();

  } catch (e) {
    showError("Network error. Please check your connection and try again.");
    resetConfirmBtn();
  }
}

function resetConfirmBtn() {
  confirmBtn.classList.remove("loading");
  confirmBtn.querySelector("span").textContent = "Confirm";
}

function showError(msg) {
  bookingError.textContent = msg;
  bookingError.classList.add("visible");
  bookingError.scrollIntoView({ behavior: "smooth", block: "center" });
}

function hideError() {
  bookingError.classList.remove("visible");
  bookingError.textContent = "";
}


// ─── SUCCESS MODAL ───────────────────────────────────────────
function showSuccess(booking) {
  $("modalBookingId").textContent = booking.booking_id;
  $("modalName").textContent      = booking.name;
  $("modalService").textContent   = booking.service.name;
  $("modalDate").textContent      = formatDateLong(booking.date);
  $("modalTime").textContent      = booking.time_label;

  modal.classList.add("visible");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  modal.classList.remove("visible");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  resetConfirmBtn();
}

function resetForm() {
  state.service    = null;
  state.time       = null;
  state.time_label = null;
  nameInput.value  = "";
  phoneInput.value = "";
  state.name  = "";
  state.phone = "";

  document.querySelectorAll(".service-opt.selected").forEach((b) => b.classList.remove("selected"));

  if (state.date) loadSlots(state.date);
  updateUI();
  resetConfirmBtn();
}


// ─── HELPERS ─────────────────────────────────────────────────
function formatDateLong(dateStr) {
  // Convert YYYY-MM-DD → DD/MM/YYYY
  try {
    const [y, m, d] = dateStr.split("-");
    if (!y || !m || !d) return dateStr;
    return `${d}/${m}/${y}`;
  } catch (e) {
    return dateStr;
  }
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}


// ============================================================
// CUSTOMER BOOKING LOOKUP
// ============================================================
function initLookup() {
  const lookupForm   = $("lookupForm");
  const lookupInput  = $("lookupInput");
  const lookupError  = $("lookupError");
  const lookupResult = $("lookupResult");

  if (!lookupForm) return;

  lookupForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const id = lookupInput.value.trim().toUpperCase();

    // hide previous state
    hideLookupError();
    lookupResult.hidden = true;
    lookupResult.classList.remove("cancelled");

    // basic validation
    if (!id) {
      showLookupError("Please enter your booking ID.");
      return;
    }
    if (!/^GHS-[A-Z0-9]{4,}$/.test(id)) {
      showLookupError("That doesn't look like a valid booking ID. It should start with GHS-");
      return;
    }

    // submit
    const btn = lookupForm.querySelector(".lookup-btn");
    const btnText = btn.querySelector("span");
    const originalText = btnText.textContent;
    btn.disabled = true;
    btnText.textContent = "Searching";

    try {
      const res = await fetch(`/bookings/${encodeURIComponent(id)}`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        showLookupError(data.error || "Booking not found. Check the ID and try again.");
        return;
      }

      renderLookupResult(data.booking);

    } catch (err) {
      showLookupError("Network error. Please check your connection and try again.");
    } finally {
      btn.disabled = false;
      btnText.textContent = originalText;
    }
  });

  // Auto-uppercase as user types
  lookupInput.addEventListener("input", () => {
    const pos = lookupInput.selectionStart;
    lookupInput.value = lookupInput.value.toUpperCase();
    lookupInput.setSelectionRange(pos, pos);
  });

  function showLookupError(msg) {
    lookupError.textContent = msg;
    lookupError.classList.add("visible");
  }

  function hideLookupError() {
    lookupError.classList.remove("visible");
    lookupError.textContent = "";
  }

  function renderLookupResult(b) {
    $("lookupResultId").textContent = b.booking_id;
    $("lookupName").textContent     = b.name;
    $("lookupService").textContent  = b.service.name;
    $("lookupDate").textContent     = formatDateLong(b.date);
    $("lookupTime").textContent     = b.time_label;
    $("lookupPrice").textContent    = `Rs. ${b.service.price}`;
    $("lookupPhone").textContent    = b.phone;

    const statusEl = $("lookupStatus");
    if (b.status === "cancelled") {
      lookupResult.classList.add("cancelled");
      statusEl.textContent = "Cancelled";
    } else {
      lookupResult.classList.remove("cancelled");
      statusEl.textContent = "Confirmed";
    }

    lookupResult.hidden = false;
    lookupResult.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}