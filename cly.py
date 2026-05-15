from flask import Flask, request, jsonify, render_template, session, redirect, url_for, Response
from datetime import datetime, date, timedelta
from functools import wraps
from collections import defaultdict
import csv
import io
import uuid
import re
import os
import hashlib
import psycopg2
from psycopg2 import Error
from dotenv import load_dotenv

# Load secrets from .env file (must exist alongside cly.py)
load_dotenv()

app = Flask(__name__)


# ─── SECRET KEY (for sessions) ───────────────────────────────
app.secret_key = os.environ.get("SECRET_KEY", "dev-only-change-me")

# ─── SALON CONFIG ────────────────────────────────────────────
SALON_CONFIG = {
    "name": "Global Hair Saloon",
    "address": "1 Pakeeza Market Street, I-8/4, Islamabad",
    "open_hour": 8,
    "open_minute": 0,
    "close_hour": 23,
    "close_minute": 0,
    "slot_duration": 45,
    "days_open": [0, 1, 2, 3, 4, 5, 6],
}

# ─── DATABASE (Supabase Postgres) ────────────────────────────
# Set via DATABASE_URL in your .env file.
# Format: postgresql://user:password@host:port/database
DATABASE_URL = os.environ.get("DATABASE_URL", "")

# ─── SERVICES ────────────────────────────────────────────────
SERVICES = [
    {"id": "haircut",           "name": "Haircut",
        "duration": 45, "price": 500},
    {"id": "beard",             "name": "Beard",
        "duration": 45, "price": 300},
    {"id": "haircut_and_beard", "name": "Haircut + Beard",
        "duration": 45, "price": 800},
]
SERVICES_MAP = {s["id"]: s for s in SERVICES}

# ─── SECURITY CONFIG ─────────────────────────────────────────
SECURITY = {
    "admin_password":        os.environ.get("ADMIN_PASSWORD", "1234"),
    "rate_limit_per_hour":   5,       # max booking attempts per IP per hour
    "one_booking_per_phone": True,    # one booking per phone number per day
    "max_name_length":       100,
    "max_phone_length":      20,
    "session_lifetime_mins": 60,      # admin session expires after 60 mins
}

# ─── RATE LIMIT STORE (in-memory) ────────────────────────────
rate_limit_store = defaultdict(list)


# ─── WHATSAPP CONFIG (Green API) ─────────────────────────────
WHATSAPP_CONFIG = {
    "barber_phone": os.environ.get("WHATSAPP_PHONE", ""),
    "id_instance":  os.environ.get("WHATSAPP_ID_INSTANCE", ""),
    "api_token":    os.environ.get("WHATSAPP_API_TOKEN", ""),
    "api_host":     os.environ.get("WHATSAPP_API_HOST", ""),
}

# ============================================================
# SECURITY HELPERS
# ============================================================


def sanitize(value, max_length=100):
    """Strip HTML/script tags and limit length."""
    if not value:
        return ""
    clean = re.sub(r"<[^>]*>", "", str(value))
    clean = re.sub(r"(javascript:|on\w+=|<script)",
                   "", clean, flags=re.IGNORECASE)
    return clean.strip()[:max_length]


def is_valid_phone(phone):
    """Allow digits, spaces, dashes, plus. Min 7 digits."""
    digits = re.sub(r"[^\d]", "", phone)
    return 7 <= len(digits) <= 15


def check_rate_limit(ip):
    """Return True if IP is within rate limit, False if exceeded."""
    now = datetime.now()
    cutoff = now - timedelta(hours=1)
    rate_limit_store[ip] = [t for t in rate_limit_store[ip] if t > cutoff]
    if len(rate_limit_store[ip]) >= SECURITY["rate_limit_per_hour"]:
        return False
    rate_limit_store[ip].append(now)
    return True


def login_required(f):
    """Decorator to protect admin routes."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("admin_logged_in"):
            return redirect(url_for("admin_login"))
        login_time = session.get("login_time")
        if login_time:
            elapsed = (datetime.now() -
                       datetime.fromisoformat(login_time)).seconds / 60
            if elapsed > SECURITY["session_lifetime_mins"]:
                session.clear()
                return redirect(url_for("admin_login"))
        return f(*args, **kwargs)
    return decorated


# ============================================================
# WHATSAPP
# ============================================================

def send_whatsapp(phone, message):
    import urllib.request
    import urllib.parse
    import json
    try:
        url = (
            f"{WHATSAPP_CONFIG['api_host']}"
            f"/waInstance{WHATSAPP_CONFIG['id_instance']}"
            f"/sendMessage/{WHATSAPP_CONFIG['api_token']}"
        )
        payload = json.dumps({
            "chatId":  f"{phone}@c.us",
            "message": message,
        }).encode("utf-8")
        req = urllib.request.Request(
            url, data=payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as res:
            return True, res.read().decode()
    except Exception as e:
        return False, str(e)


def notify_barber(booking):
    message = (
        f"New Booking - Global Hair Saloon\n\n"
        f"Client: {booking['name']}\n"
        f"Phone: {booking['phone']}\n"
        f"Service: {booking['service']['name']}\n"
        f"Date: {booking['date']}\n"
        f"Time: {booking['time_label']}\n"
        f"Booking ID: {booking['booking_id']}\n"
        f"Price: Rs. {booking['service']['price']}"
    )
    success, response = send_whatsapp(WHATSAPP_CONFIG["barber_phone"], message)
    if success:
        print(f"✓ WhatsApp sent for {booking['booking_id']}")
    else:
        print(f"✗ WhatsApp failed: {response}")
    return success


# ============================================================
# DATABASE
# ============================================================

def get_db():
    """Open a PostgreSQL connection to Supabase using DATABASE_URL."""
    if not DATABASE_URL:
        raise Exception(
            "DATABASE_URL is not set. Check your .env file alongside cly.py.")
    try:
        return psycopg2.connect(DATABASE_URL)
    except Error as e:
        raise Exception(f"Database connection failed: {e}")


def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS bookings (
            id            SERIAL PRIMARY KEY,
            booking_id    VARCHAR(20)  NOT NULL UNIQUE,
            name          VARCHAR(100) NOT NULL,
            phone         VARCHAR(20)  NOT NULL,
            service_id    VARCHAR(50)  NOT NULL,
            service_name  VARCHAR(100) NOT NULL,
            service_price INTEGER      NOT NULL,
            date          DATE         NOT NULL,
            time          VARCHAR(5)   NOT NULL,
            time_label    VARCHAR(15)  NOT NULL,
            booked_at     TIMESTAMP    NOT NULL,
            status        VARCHAR(20)  NOT NULL DEFAULT 'confirmed',
            CONSTRAINT unique_slot UNIQUE (date, time)
        )
    """)
    conn.commit()
    cursor.close()
    conn.close()
    print("✓ Database initialized")


# ============================================================
# SHOP STATUS (open / closed)
# ============================================================

def init_state_table():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS salon_state (
            id              INTEGER      PRIMARY KEY,
            is_open         BOOLEAN      NOT NULL DEFAULT TRUE,
            closure_message VARCHAR(255) DEFAULT NULL,
            reopen_date     DATE         DEFAULT NULL,
            updated_at      TIMESTAMP    NOT NULL
        )
    """)
    cursor.execute("""
        INSERT INTO salon_state (id, is_open, updated_at)
        VALUES (1, TRUE, %s)
        ON CONFLICT (id) DO NOTHING
    """, (datetime.now(),))
    conn.commit()
    cursor.close()
    conn.close()
    print("✓ Salon state initialized")


def init_barber_tables():
    """Barbers, their clock-in/out sessions, and customer ratings."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS barbers (
            id         SERIAL       PRIMARY KEY,
            username   VARCHAR(50)  NOT NULL UNIQUE,
            password   VARCHAR(255) NOT NULL,
            name       VARCHAR(100) NOT NULL,
            status     VARCHAR(20)  NOT NULL DEFAULT 'active',
            created_at TIMESTAMP    NOT NULL
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS barber_sessions (
            id           SERIAL    PRIMARY KEY,
            barber_id    INTEGER   NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
            clock_in     TIMESTAMP NOT NULL,
            clock_out    TIMESTAMP DEFAULT NULL,
            minutes      INTEGER   DEFAULT NULL
        )
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_barber_date
        ON barber_sessions (barber_id, clock_in)
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ratings (
            id          SERIAL       PRIMARY KEY,
            booking_id  VARCHAR(20)  NOT NULL UNIQUE,
            barber_id   INTEGER      NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
            stars       SMALLINT     NOT NULL,
            comment     VARCHAR(500) DEFAULT NULL,
            created_at  TIMESTAMP    NOT NULL
        )
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_barber ON ratings (barber_id)
    """)

    conn.commit()
    cursor.close()
    conn.close()
    print("✓ Barber tables initialized")


def migrate_bookings_barber_id():
    """Add barber_id column to bookings table if it doesn't already exist.
    PostgreSQL supports IF NOT EXISTS on ALTER TABLE, making this trivial."""
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS barber_id INTEGER")
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_booking_barber ON bookings(barber_id)")
        conn.commit()
        print("✓ bookings.barber_id verified / added")
    except Error as e:
        print(f"  (barber_id migration warning: {e})")
    finally:
        cursor.close()
        conn.close()


def get_salon_state():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT is_open, closure_message, reopen_date, updated_at
        FROM salon_state WHERE id = 1
    """)
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    if not row:
        return {"is_open": True, "closure_message": None, "reopen_date": None, "updated_at": None}
    return {
        "is_open":         bool(row[0]),
        "closure_message": row[1],
        "reopen_date":     str(row[2]) if row[2] else None,
        "updated_at":      str(row[3]),
    }


# ============================================================
# HELPERS
# ============================================================

def generate_slots(date_str):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT time FROM bookings WHERE date = %s AND status = 'confirmed'",
        (date_str,)
    )
    booked_times = {row[0] for row in cursor.fetchall()}
    cursor.close()
    conn.close()

    slots = []
    open_mins = SALON_CONFIG["open_hour"] * 60 + SALON_CONFIG["open_minute"]
    close_mins = SALON_CONFIG["close_hour"] * 60 + SALON_CONFIG["close_minute"]
    current = open_mins
    while current + SALON_CONFIG["slot_duration"] <= close_mins:
        h, m = current // 60, current % 60
        time_str = f"{h:02d}:{m:02d}"
        slots.append({
            "time":      time_str,
            "label":     format_time(h, m),
            "available": time_str not in booked_times
        })
        current += SALON_CONFIG["slot_duration"]
    return slots


def format_time(h, m):
    period = "PM" if h >= 12 else "AM"
    hour = h - 12 if h > 12 else (12 if h == 0 else h)
    return f"{hour}:{m:02d} {period}"


def is_salon_open(date_str):
    d = datetime.strptime(date_str, "%Y-%m-%d").date()
    return d.weekday() in SALON_CONFIG["days_open"]


def is_past_slot(date_str, time_str):
    h, m = map(int, time_str.split(":"))
    y, mo, day = map(int, date_str.split("-"))
    return datetime(y, mo, day, h, m) <= datetime.now()


def is_valid_date(date_str):
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def generate_booking_id():
    return f"GHS-{uuid.uuid4().hex[:8].upper()}"


def row_to_booking(row):
    """Maps a row that includes booking_id..status. If barber name is included
    as the 12th column (LEFT JOIN result), add it to the booking dict."""
    b = {
        "booking_id": row[0],
        "name":       row[1],
        "phone":      row[2],
        "service":    {"id": row[3], "name": row[4], "price": row[5]},
        "date":       str(row[6]),
        "time":       row[7],
        "time_label": row[8],
        "booked_at":  str(row[9]),
        "status":     row[10],
    }
    if len(row) > 11:
        b["barber"] = {"id": row[11], "name": row[12]
                       if len(row) > 12 else None}
    return b


def phone_already_booked_today(phone, date_str):
    """Check if a phone number already has a booking on this date."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT COUNT(*) FROM bookings WHERE phone = %s AND date = %s AND status = 'confirmed'",
        (phone, date_str)
    )
    count = cursor.fetchone()[0]
    cursor.close()
    conn.close()
    return count > 0


# ============================================================
# PUBLIC API ROUTES
# ============================================================

@app.route("/")
def index():
    """Customer-facing landing page."""
    return render_template("index.html")


@app.route("/api")
def api_info():
    """API info — moved here so '/' can serve the customer site."""
    return jsonify({
        "salon":   SALON_CONFIG["name"],
        "address": SALON_CONFIG["address"],
        "status":  "open",
        "endpoints": [
            "GET    /services",
            "GET    /salon/status",
            "GET    /slots?date=YYYY-MM-DD",
            "POST   /bookings",
            "GET    /bookings/<booking_id>",
        ]
    })


@app.route("/services", methods=["GET"])
def get_services():
    return jsonify({"success": True, "total": len(SERVICES), "services": SERVICES})


@app.route("/barbers", methods=["GET"])
def public_barbers():
    """List active barbers — used in customer booking flow to choose one."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT b.id, b.name,
               COALESCE(AVG(r.stars), 0) AS avg_rating,
               COUNT(r.id) AS rating_count
        FROM barbers b
        LEFT JOIN ratings r ON r.barber_id = b.id
        WHERE b.status = 'active'
        GROUP BY b.id, b.name
        ORDER BY b.name ASC
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return jsonify({
        "success": True,
        "barbers": [{
            "id":           r[0],
            "name":         r[1],
            "avg_rating":   round(float(r[2]), 1) if r[2] else 0,
            "rating_count": int(r[3]),
        } for r in rows]
    })


@app.route("/salon/status", methods=["GET"])
def salon_status():
    """Public — customer site checks this before showing the booking form."""
    return jsonify({"success": True, "state": get_salon_state()})


@app.route("/slots", methods=["GET"])
def get_slots():
    date_str = request.args.get("date")
    if not date_str:
        return jsonify({"success": False, "error": "date parameter is required (YYYY-MM-DD)"}), 400
    if not is_valid_date(date_str):
        return jsonify({"success": False, "error": "Invalid date format. Use YYYY-MM-DD"}), 400
    if not is_salon_open(date_str):
        return jsonify({"success": False, "error": "Salon is closed on this day"}), 400

    today_str = date.today().isoformat()
    slots = []
    for slot in generate_slots(date_str):
        available = slot["available"]
        if date_str == today_str and is_past_slot(date_str, slot["time"]):
            available = False
        slots.append({**slot, "available": available})

    return jsonify({
        "success":         True,
        "date":            date_str,
        "total_slots":     len(slots),
        "available_slots": sum(1 for s in slots if s["available"]),
        "slots":           slots
    })


@app.route("/bookings", methods=["POST"])
def create_booking():
    # ── Rate limiting ──────────────────────────────────────────
    ip = request.remote_addr
    if not check_rate_limit(ip):
        return jsonify({"success": False,
                        "error": "Too many booking attempts. Please wait an hour and try again."}), 429

    # ── Shop must be open ──────────────────────────────────────
    state = get_salon_state()
    if not state["is_open"]:
        msg = state["closure_message"] or "We are temporarily not accepting bookings."
        if state["reopen_date"]:
            msg += f" Reopening on {state['reopen_date']}."
        return jsonify({"success": False, "error": msg, "shop_closed": True}), 503

    data = request.get_json()
    if not data:
        return jsonify({"success": False, "error": "JSON body required"}), 400

    # ── Sanitize inputs ────────────────────────────────────────
    name = sanitize(data.get("name",       ""), SECURITY["max_name_length"])
    phone = sanitize(data.get("phone",      ""), SECURITY["max_phone_length"])
    service_id = sanitize(data.get("service_id", ""), 50)
    date_str = sanitize(data.get("date",       ""), 10)
    time_str = sanitize(data.get("time",       ""), 5)

    # ── Validate required fields ───────────────────────────────
    if not all([name, phone, service_id, date_str, time_str]):
        return jsonify({"success": False, "error": "name, phone, service_id, date, and time are all required"}), 400

    # ── Validate barber_id ─────────────────────────────────────
    try:
        barber_id = int(data.get("barber_id") or 0)
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "Invalid barber selection"}), 400
    if not barber_id:
        return jsonify({"success": False, "error": "Please choose a barber"}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT name FROM barbers WHERE id = %s AND status = 'active'", (barber_id,))
    barber_row = cursor.fetchone()
    cursor.close()
    conn.close()
    if not barber_row:
        return jsonify({"success": False, "error": "Selected barber is not available"}), 400
    barber_name = barber_row[0]

    # ── Validate phone format ──────────────────────────────────
    if not is_valid_phone(phone):
        return jsonify({"success": False, "error": "Invalid phone number"}), 400

    # ── Validate service ───────────────────────────────────────
    service = SERVICES_MAP.get(service_id)
    if not service:
        return jsonify({"success": False, "error": f"Invalid service_id '{service_id}'"}), 400

    # ── Validate date ──────────────────────────────────────────
    if not is_valid_date(date_str):
        return jsonify({"success": False, "error": "Invalid date format. Use YYYY-MM-DD"}), 400
    if not is_salon_open(date_str):
        return jsonify({"success": False, "error": "Salon is closed on this day"}), 400

    # ── Validate time slot ─────────────────────────────────────
    valid_times = [s["time"] for s in generate_slots(date_str)]
    if time_str not in valid_times:
        return jsonify({"success": False,
                        "error": f"'{time_str}' is not a valid slot. Slots run every 45 min from 08:00 to 22:15"}), 400

    if is_past_slot(date_str, time_str):
        return jsonify({"success": False, "error": "Cannot book a past time slot"}), 400

    # ── One booking per phone per day ──────────────────────────
    if SECURITY["one_booking_per_phone"] and phone_already_booked_today(phone, date_str):
        return jsonify({"success": False,
                        "error": "This phone number already has a booking on this date"}), 409

    # ── Insert into database ───────────────────────────────────
    booking_id = generate_booking_id()
    h, m = map(int, time_str.split(":"))
    time_label = format_time(h, m)
    booked_at = datetime.now()

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO bookings
                (booking_id, name, phone, service_id, service_name, service_price,
                 date, time, time_label, booked_at, status, barber_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (booking_id, name, phone,
              service["id"], service["name"], service["price"],
              date_str, time_str, time_label, booked_at, "confirmed", barber_id))
        conn.commit()
        cursor.close()
        conn.close()
    except Error as e:
        if "duplicate key" in str(e).lower():
            return jsonify({"success": False,
                            "error": "This slot is already booked. Please choose another time"}), 409
        return jsonify({"success": False, "error": f"Database error: {e}"}), 500

    booking = {
        "booking_id": booking_id, "name": name, "phone": phone,
        "service": service, "date": date_str, "time": time_str,
        "time_label": time_label, "booked_at": booked_at.isoformat(),
        "status": "confirmed",
        "barber": {"id": barber_id, "name": barber_name},
    }

    notify_barber(booking)

    return jsonify({
        "success": True,
        "message": f"Booking confirmed for {name} with {barber_name} on {date_str} at {time_label}",
        "booking": booking
    }), 201


@app.route("/bookings/<booking_id>", methods=["GET"])
def get_booking(booking_id):
    booking_id = sanitize(booking_id, 20)
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT booking_id, name, phone, service_id, service_name, service_price,
               date, time, time_label, booked_at, status
        FROM bookings WHERE booking_id = %s
    """, (booking_id,))
    row = cursor.fetchone()
    cursor.close()
    conn.close()

    if not row:
        return jsonify({"success": False, "error": f"Booking '{booking_id}' not found"}), 404
    return jsonify({"success": True, "booking": row_to_booking(row)})


# ============================================================
# ADMIN ROUTES (protected)
# ============================================================

@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    error = None
    if request.method == "POST":
        password = request.form.get("password", "")
        if password == SECURITY["admin_password"]:
            session["admin_logged_in"] = True
            session["login_time"] = datetime.now().isoformat()
            return redirect(url_for("admin_panel"))
        else:
            error = "Incorrect password"

    return render_template("admin_login.html", error=error)


@app.route("/admin/logout")
def admin_logout():
    session.clear()
    return redirect(url_for("admin_login"))


@app.route("/admin")
@login_required
def admin_panel():
    return render_template("admin.html")


# ── Admin shop-status endpoints ───────────────────────────────

@app.route("/admin/salon/state", methods=["GET"])
@login_required
def admin_salon_state():
    return jsonify({"success": True, "state": get_salon_state()})


@app.route("/admin/salon/toggle", methods=["POST"])
@login_required
def admin_salon_toggle():
    data = request.get_json() or {}
    is_open = bool(data.get("is_open", True))
    closure_message = sanitize(data.get("closure_message", ""), 255) or None
    reopen_date = data.get("reopen_date") or None

    if reopen_date and not is_valid_date(reopen_date):
        return jsonify({"success": False, "error": "Invalid reopen_date"}), 400

    # Clear closure fields if shop is being reopened
    if is_open:
        closure_message = None
        reopen_date = None

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE salon_state
        SET is_open = %s, closure_message = %s, reopen_date = %s, updated_at = %s
        WHERE id = 1
    """, (is_open, closure_message, reopen_date, datetime.now()))
    conn.commit()
    cursor.close()
    conn.close()
    return jsonify({"success": True, "state": get_salon_state()})


# ── Admin-only booking endpoints ──────────────────────────────

@app.route("/admin/bookings", methods=["GET"])
@login_required
def admin_get_bookings():
    date_str = request.args.get("date")
    if not date_str or not is_valid_date(date_str):
        return jsonify({"success": False, "error": "Valid date required"}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT b.booking_id, b.name, b.phone, b.service_id, b.service_name, b.service_price,
               b.date, b.time, b.time_label, b.booked_at, b.status,
               b.barber_id, ba.name
        FROM bookings b
        LEFT JOIN barbers ba ON ba.id = b.barber_id
        WHERE b.date = %s AND b.status = 'confirmed' ORDER BY b.time ASC
    """, (date_str,))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    return jsonify({"success": True, "date": date_str,
                    "total": len(rows), "bookings": [row_to_booking(r) for r in rows]})


@app.route("/admin/bookings/<booking_id>", methods=["DELETE"])
@login_required
def admin_cancel_booking(booking_id):
    booking_id = sanitize(booking_id, 20)
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT booking_id, name, phone, service_id, service_name, service_price,
               date, time, time_label, booked_at, status
        FROM bookings WHERE booking_id = %s
    """, (booking_id,))
    row = cursor.fetchone()

    if not row:
        cursor.close()
        conn.close()
        return jsonify({"success": False, "error": f"Booking '{booking_id}' not found"}), 404

    cursor.execute(
        "UPDATE bookings SET status = 'cancelled' WHERE booking_id = %s",
        (booking_id,)
    )
    conn.commit()
    cursor.close()
    conn.close()

    booking = row_to_booking(row)
    booking["status"] = "cancelled"
    return jsonify({"success": True,
                    "message": f"Booking {booking_id} cancelled",
                    "booking": booking})


# ============================================================
# WALK-IN BOOKING — admin only, bypasses rate limit + one-per-phone
# ============================================================

@app.route("/admin/bookings/walkin", methods=["POST"])
@login_required
def admin_walkin_booking():
    """Quick walk-in booking from the admin panel."""
    data = request.get_json() or {}

    name = sanitize(data.get("name",       ""), SECURITY["max_name_length"])
    phone = sanitize(data.get("phone",      ""), SECURITY["max_phone_length"])
    service_id = sanitize(data.get("service_id", ""), 50)
    date_str = sanitize(data.get("date",       ""), 10)
    time_str = sanitize(data.get("time",       ""), 5)

    # barber_id is optional for walk-ins
    try:
        barber_id = int(data.get("barber_id") or 0) or None
    except (TypeError, ValueError):
        barber_id = None

    if not all([name, phone, service_id, date_str, time_str]):
        return jsonify({"success": False, "error": "All fields required"}), 400

    if not is_valid_phone(phone):
        return jsonify({"success": False, "error": "Invalid phone number"}), 400

    service = SERVICES_MAP.get(service_id)
    if not service:
        return jsonify({"success": False, "error": "Invalid service"}), 400

    if not is_valid_date(date_str):
        return jsonify({"success": False, "error": "Invalid date"}), 400

    valid_times = [s["time"] for s in generate_slots(date_str)]
    if time_str not in valid_times:
        return jsonify({"success": False, "error": "Invalid time slot"}), 400

    booking_id = generate_booking_id()
    h, m = map(int, time_str.split(":"))
    time_label = format_time(h, m)
    booked_at = datetime.now()

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO bookings
                (booking_id, name, phone, service_id, service_name, service_price,
                 date, time, time_label, booked_at, status, barber_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (booking_id, name, phone,
              service["id"], service["name"], service["price"],
              date_str, time_str, time_label, booked_at, "confirmed", barber_id))
        conn.commit()
        cursor.close()
        conn.close()
    except Error as e:
        if "duplicate key" in str(e).lower():
            return jsonify({"success": False,
                            "error": "This slot is already booked"}), 409
        return jsonify({"success": False, "error": f"Database error: {e}"}), 500

    return jsonify({
        "success": True,
        "message": f"Walk-in booked: {name} for {time_label}",
        "booking": {
            "booking_id": booking_id, "name": name, "phone": phone,
            "service": service, "date": date_str, "time": time_str,
            "time_label": time_label, "booked_at": booked_at.isoformat(),
            "status": "confirmed"
        }
    }), 201


# ============================================================
# SEARCH BOOKINGS — by name / phone / booking ID
# ============================================================

@app.route("/admin/bookings/search", methods=["GET"])
@login_required
def admin_search_bookings():
    q = sanitize(request.args.get("q", ""), 100)
    if not q or len(q) < 2:
        return jsonify({"success": True, "results": [], "total": 0, "query": q})

    like = f"%{q}%"
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT booking_id, name, phone, service_id, service_name, service_price,
               date, time, time_label, booked_at, status
        FROM bookings
        WHERE booking_id LIKE %s OR name LIKE %s OR phone LIKE %s
        ORDER BY date DESC, time DESC
        LIMIT 50
    """, (like, like, like))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    return jsonify({
        "success": True,
        "query":   q,
        "total":   len(rows),
        "results": [row_to_booking(r) for r in rows]
    })


# ============================================================
# CSV EXPORT
# ============================================================

@app.route("/admin/export", methods=["GET"])
@login_required
def admin_export_csv():
    start = sanitize(request.args.get("start", ""), 10)
    end = sanitize(request.args.get("end",   ""), 10)

    if not is_valid_date(start) or not is_valid_date(end):
        return jsonify({"success": False, "error": "Valid start and end dates required"}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT booking_id, name, phone, service_name, service_price,
               date, time_label, booked_at, status
        FROM bookings
        WHERE date >= %s AND date <= %s
        ORDER BY date ASC, time ASC
    """, (start, end))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Booking ID", "Name", "Phone", "Service", "Price (Rs.)",
        "Date", "Time", "Booked At", "Status"
    ])
    for r in rows:
        writer.writerow([r[0], r[1], r[2], r[3], r[4],
                         str(r[5]), r[6], str(r[7]), r[8]])

    csv_text = output.getvalue()
    output.close()

    filename = f"global-hair-saloon_{start}_to_{end}.csv"
    return Response(
        csv_text,
        mimetype="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


# ============================================================
# ANALYTICS — POPULAR SERVICES
# ============================================================

@app.route("/admin/analytics/services", methods=["GET"])
@login_required
def admin_analytics_services():
    """Returns service breakdown by count and revenue for the period."""
    try:
        days = int(request.args.get("days", 30))
    except ValueError:
        days = 30
    days = max(1, min(days, 365))

    start_date = (date.today() - timedelta(days=days)).isoformat()

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT service_id, service_name, COUNT(*) as cnt, SUM(service_price) as rev
        FROM bookings
        WHERE date >= %s AND status = 'confirmed'
        GROUP BY service_id, service_name
        ORDER BY cnt DESC
    """, (start_date,))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    total_count = sum(r[2] for r in rows) if rows else 0
    total_revenue = sum(int(r[3] or 0) for r in rows) if rows else 0

    services = [{
        "service_id": r[0],
        "name":       r[1],
        "count":      r[2],
        "revenue":    int(r[3] or 0),
        "percent":    round((r[2] / total_count * 100), 1) if total_count else 0,
    } for r in rows]

    return jsonify({
        "success":       True,
        "days":          days,
        "total_bookings": total_count,
        "total_revenue":  total_revenue,
        "services":       services,
    })


# ============================================================
# ANALYTICS — PEAK HOURS / DAYS
# ============================================================

@app.route("/admin/analytics/peak", methods=["GET"])
@login_required
def admin_analytics_peak():
    """Returns booking counts grouped by hour-of-day and day-of-week."""
    try:
        days = int(request.args.get("days", 30))
    except ValueError:
        days = 30
    days = max(1, min(days, 365))

    start_date = (date.today() - timedelta(days=days)).isoformat()

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT time, date
        FROM bookings
        WHERE date >= %s AND status = 'confirmed'
    """, (start_date,))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    hour_counts = {h: 0 for h in range(8, 23)}
    day_counts = {d: 0 for d in range(7)}

    for time_str, d in rows:
        try:
            hour = int(time_str.split(":")[0])
            if hour in hour_counts:
                hour_counts[hour] += 1
            day_counts[d.weekday()] += 1
        except Exception:
            continue

    hours = [
        {"hour": h, "label": format_time(
            h, 0).replace(":00 ", " "), "count": c}
        for h, c in hour_counts.items()
    ]
    day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    weekdays = [
        {"day": i, "label": day_names[i], "count": day_counts[i]}
        for i in range(7)
    ]

    peak_hour = max(hours, key=lambda x: x["count"]) if any(
        h["count"] for h in hours) else None
    peak_day = max(weekdays, key=lambda x: x["count"]) if any(
        d["count"] for d in weekdays) else None

    return jsonify({
        "success":   True,
        "days":      days,
        "total":     len(rows),
        "hours":     hours,
        "weekdays":  weekdays,
        "peak_hour": peak_hour,
        "peak_day":  peak_day,
    })


# ============================================================
# DEBUG — image folder inspector (helps diagnose missing photos)
# ============================================================

@app.route("/debug/images")
def debug_images():
    """Visit this in browser to see what photos Flask can find."""
    static_path = os.path.join(app.root_path, "static", "img")
    expected = ["cut-1.jpeg", "cut-2.jpeg", "cut-3.jpeg",
                "cut-4.jpeg", "cut-5.jpeg",
                "inside.jpeg", "outside.jpeg"]

    if not os.path.exists(static_path):
        return jsonify({
            "ok": False,
            "problem": "The static/img folder does not exist",
            "expected_path": static_path,
            "fix": "Create a folder named 'img' inside your project's 'static/' folder, and put the 8 .jpeg files in it."
        })

    found = sorted(os.listdir(static_path))
    missing = [f for f in expected if f not in found]

    return jsonify({
        "ok":            len(missing) == 0,
        "folder_path":   static_path,
        "found_files":   found,
        "expected":      expected,
        "missing":       missing,
        "fix":           ("All 8 photos found ✓"
                          if not missing
                          else f"Missing files: {missing}. Names must match exactly (case-sensitive).")
    })


# ============================================================
# BARBERS — DECORATOR + HELPERS
# ============================================================


def hash_pw(password):
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def barber_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("barber_id"):
            return redirect(url_for("barber_login"))
        return f(*args, **kwargs)
    return decorated


def get_barber_stats(barber_id):
    """Hours worked (today/week/month) + rating + booking count."""
    conn = get_db()
    cursor = conn.cursor()

    today = date.today()
    week_start = (today - timedelta(days=today.weekday())).isoformat()
    month_start = today.replace(day=1).isoformat()
    today_str = today.isoformat()

    def sum_minutes(since_date):
        cursor.execute("""
            SELECT
              COALESCE(SUM(
                CASE
                  WHEN clock_out IS NOT NULL THEN minutes
                  ELSE EXTRACT(EPOCH FROM (NOW() - clock_in)) / 60
                END
              ), 0)
            FROM barber_sessions
            WHERE barber_id = %s AND clock_in::date >= %s
        """, (barber_id, since_date))
        return int(cursor.fetchone()[0] or 0)

    today_min = sum_minutes(today_str)
    week_min = sum_minutes(week_start)
    month_min = sum_minutes(month_start)

    cursor.execute("""
        SELECT AVG(stars), COUNT(*)
        FROM ratings WHERE barber_id = %s
    """, (barber_id,))
    avg_row = cursor.fetchone()
    avg_rating = float(avg_row[0]) if avg_row[0] is not None else 0
    rating_count = int(avg_row[1] or 0)

    # Is currently clocked in?
    cursor.execute("""
        SELECT id, clock_in FROM barber_sessions
        WHERE barber_id = %s AND clock_out IS NULL
        ORDER BY clock_in DESC LIMIT 1
    """, (barber_id,))
    open_session = cursor.fetchone()

    cursor.close()
    conn.close()

    return {
        "today_minutes":  today_min,
        "week_minutes":   week_min,
        "month_minutes":  month_min,
        "today_hours":    round(today_min / 60, 1),
        "week_hours":     round(week_min / 60, 1),
        "month_hours":    round(month_min / 60, 1),
        "avg_rating":     round(avg_rating, 1),
        "rating_count":   rating_count,
        "is_clocked_in":  open_session is not None,
        "current_session_started":
            open_session[1].isoformat() if open_session else None,
    }


# ============================================================
# BARBER AUTH ROUTES
# ============================================================

@app.route("/barber/login", methods=["GET", "POST"])
def barber_login():
    error = None
    if request.method == "POST":
        username = sanitize(request.form.get("username", ""), 50)
        password = request.form.get("password", "")

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, name, status FROM barbers
            WHERE username = %s AND password = %s
        """, (username, hash_pw(password)))
        row = cursor.fetchone()
        cursor.close()
        conn.close()

        if row and row[2] == "active":
            session["barber_id"] = row[0]
            session["barber_name"] = row[1]
            return redirect(url_for("barber_dashboard"))
        else:
            error = "Wrong username or password" if not row else "Account inactive"

    return render_template("barber_login.html", error=error)


@app.route("/barber/logout")
def barber_logout():
    session.pop("barber_id",   None)
    session.pop("barber_name", None)
    return redirect(url_for("barber_login"))


@app.route("/barber")
@barber_required
def barber_dashboard():
    return render_template("barber.html", name=session.get("barber_name", "Barber"))


@app.route("/barber/me", methods=["GET"])
@barber_required
def barber_me():
    barber_id = session["barber_id"]
    return jsonify({
        "success": True,
        "barber": {
            "id":   barber_id,
            "name": session.get("barber_name"),
        },
        "stats": get_barber_stats(barber_id),
    })


@app.route("/barber/clock", methods=["POST"])
@barber_required
def barber_clock():
    """Toggle clock — opens a session if none open, else closes it."""
    barber_id = session["barber_id"]
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT id, clock_in FROM barber_sessions
        WHERE barber_id = %s AND clock_out IS NULL
        ORDER BY clock_in DESC LIMIT 1
    """, (barber_id,))
    open_session = cursor.fetchone()

    if open_session:
        # Clock out
        session_id, clock_in_time = open_session
        now = datetime.now()
        minutes = int((now - clock_in_time).total_seconds() / 60)
        cursor.execute("""
            UPDATE barber_sessions
            SET clock_out = %s, minutes = %s
            WHERE id = %s
        """, (now, minutes, session_id))
        conn.commit()
        action = "out"
    else:
        # Clock in
        cursor.execute("""
            INSERT INTO barber_sessions (barber_id, clock_in)
            VALUES (%s, %s)
        """, (barber_id, datetime.now()))
        conn.commit()
        action = "in"

    cursor.close()
    conn.close()
    return jsonify({
        "success": True,
        "action":  action,
        "stats":   get_barber_stats(barber_id),
    })


# ============================================================
# ADMIN — BARBER MANAGEMENT
# ============================================================

@app.route("/admin/barbers", methods=["GET"])
@login_required
def admin_list_barbers():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, username, name, status, created_at
        FROM barbers ORDER BY created_at ASC
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    barbers = []
    for r in rows:
        stats = get_barber_stats(r[0])
        barbers.append({
            "id":         r[0],
            "username":   r[1],
            "name":       r[2],
            "status":     r[3],
            "created_at": str(r[4]),
            "stats":      stats,
        })

    return jsonify({"success": True, "total": len(barbers), "barbers": barbers})


@app.route("/admin/barbers", methods=["POST"])
@login_required
def admin_add_barber():
    data = request.get_json() or {}
    username = sanitize(data.get("username", ""), 50).lower()
    name = sanitize(data.get("name",     ""), 100)
    password = data.get("password", "")

    if not username or not name or not password:
        return jsonify({"success": False, "error": "username, name and password are required"}), 400
    if len(password) < 4:
        return jsonify({"success": False, "error": "Password must be at least 4 characters"}), 400
    if not re.match(r"^[a-z0-9_]{3,}$", username):
        return jsonify({"success": False, "error": "Username must be lowercase letters/numbers/underscore"}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO barbers (username, password, name, status, created_at)
            VALUES (%s, %s, %s, 'active', %s)
            RETURNING id
        """, (username, hash_pw(password), name, datetime.now()))
        new_id = cursor.fetchone()[0]
        conn.commit()
        cursor.close()
        conn.close()
    except Error as e:
        if "duplicate key" in str(e).lower():
            return jsonify({"success": False, "error": "Username already exists"}), 409
        return jsonify({"success": False, "error": f"Database error: {e}"}), 500

    return jsonify({"success": True, "barber": {
        "id": new_id, "username": username, "name": name, "status": "active"
    }}), 201


@app.route("/admin/barbers/<int:bid>", methods=["DELETE"])
@login_required
def admin_remove_barber(bid):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM barbers WHERE id = %s", (bid,))
    conn.commit()
    affected = cursor.rowcount
    cursor.close()
    conn.close()
    if affected == 0:
        return jsonify({"success": False, "error": "Barber not found"}), 404
    return jsonify({"success": True, "message": "Barber removed"})


# ============================================================
# RATINGS — public (no auth) + admin view
# ============================================================

@app.route("/rate/<booking_id>", methods=["GET"])
def rate_page(booking_id):
    """Public rating page — opened from the customer's booking confirmation."""
    booking_id = sanitize(booking_id, 20)

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT booking_id, name, service_name, date, time_label, status
        FROM bookings WHERE booking_id = %s
    """, (booking_id,))
    booking = cursor.fetchone()

    cursor.execute("""
        SELECT id, name FROM barbers WHERE status = 'active' ORDER BY name ASC
    """)
    barbers = cursor.fetchall()

    cursor.execute(
        "SELECT id FROM ratings WHERE booking_id = %s", (booking_id,))
    existing = cursor.fetchone()

    cursor.close()
    conn.close()

    return render_template(
        "rate.html",
        booking_found=booking is not None,
        booking_id=booking_id,
        booking_name=booking[1] if booking else "",
        booking_service=booking[2] if booking else "",
        booking_date=str(booking[3]) if booking else "",
        booking_time=booking[4] if booking else "",
        barbers=[{"id": b[0], "name": b[1]} for b in barbers],
        already_rated=existing is not None,
    )


@app.route("/rate/<booking_id>", methods=["POST"])
def submit_rating(booking_id):
    booking_id = sanitize(booking_id, 20)
    data = request.get_json() or {}

    try:
        stars = int(data.get("stars", 0))
        barber_id = int(data.get("barber_id", 0))
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "Invalid rating data"}), 400

    comment = sanitize(data.get("comment", ""), 500) or None

    if stars < 1 or stars > 5:
        return jsonify({"success": False, "error": "Stars must be 1–5"}), 400

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT id FROM bookings WHERE booking_id = %s", (booking_id,))
    if not cursor.fetchone():
        cursor.close()
        conn.close()
        return jsonify({"success": False, "error": "Booking not found"}), 404

    cursor.execute("SELECT id FROM barbers WHERE id = %s", (barber_id,))
    if not cursor.fetchone():
        cursor.close()
        conn.close()
        return jsonify({"success": False, "error": "Invalid barber"}), 400

    try:
        cursor.execute("""
            INSERT INTO ratings (booking_id, barber_id, stars, comment, created_at)
            VALUES (%s, %s, %s, %s, %s)
        """, (booking_id, barber_id, stars, comment, datetime.now()))
        conn.commit()
    except Error as e:
        cursor.close()
        conn.close()
        if "duplicate key" in str(e).lower():
            return jsonify({"success": False, "error": "This booking has already been rated"}), 409
        return jsonify({"success": False, "error": f"Database error: {e}"}), 500

    cursor.close()
    conn.close()
    return jsonify({"success": True, "message": "Thanks for your feedback!"}), 201


@app.route("/admin/barbers/<int:bid>/ratings", methods=["GET"])
@login_required
def admin_barber_ratings(bid):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT r.booking_id, r.stars, r.comment, r.created_at, b.name
        FROM ratings r
        JOIN bookings b ON b.booking_id = r.booking_id
        WHERE r.barber_id = %s
        ORDER BY r.created_at DESC
        LIMIT 50
    """, (bid,))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    return jsonify({"success": True, "ratings": [{
        "booking_id":  r[0],
        "stars":       r[1],
        "comment":     r[2],
        "created_at":  str(r[3]),
        "client_name": r[4],
    } for r in rows]})


# ─── RUN ─────────────────────────────────────────────────────
if __name__ == "__main__":
    init_db()
    init_state_table()
    init_barber_tables()
    migrate_bookings_barber_id()
    app.run(debug=True, port=5000)
