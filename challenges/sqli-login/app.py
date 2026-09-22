"""SecureVault -- a login form that trusts what it is given, which is the bug.

CTF_FLAG is read at startup, never baked in, so the copy one team solves is
not the copy another team can be handed. Two modes live on the same page:
EASY applies no filter at all; HARD blocks the raw literal characters an
injection needs (' " -- # ;) before they ever reach the query -- so the
input has to arrive already hidden from that filter, and get unwrapped
only afterwards, on the way into the database.
"""
import base64
import os
import secrets
import sqlite3

from flask import Flask, request, render_template_string

app = Flask(__name__)

FLAG = os.environ.get("CTF_FLAG", "OFFCON{local-test-flag}")
DB_PATH = "/tmp/vault.db"
ADMIN_SECRET = secrets.token_hex(16)  # unknown to the player -- the point is never to need it

BANNED = ["'", '"', "--", "#", ";"]

HINTS = {
    "easy": "No input filtering here. This is a straight, classic broken login form.",
    "hard": (
        "This form blocks the characters "
        + "  ".join(f"<code>{b}</code>" for b in BANNED)
        + " -- but only in exactly what you send. It never looks twice."
    ),
}

PAGE = """<!doctype html>
<title>SecureVault</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{font-family:ui-monospace,Menlo,Consolas,monospace;background:#0d1117;color:#c9d1d9;
       max-width:520px;margin:56px auto;padding:0 16px}
  h2{margin-bottom:4px}
  .sub{color:#8b949e;font-size:13px;margin-top:0}
  .mode{margin:18px 0}
  .mode a{display:inline-block;padding:6px 16px;border:1px solid #30363d;text-decoration:none;
          color:#c9d1d9;margin-right:8px;border-radius:6px;font-size:13px}
  .mode a.active{background:#1f6feb;border-color:#1f6feb;color:#fff}
  .hint{color:#8b949e;font-size:13px;line-height:1.6}
  code{background:#161b22;padding:1px 5px;border-radius:4px}
  input{width:100%;box-sizing:border-box;padding:9px;margin:6px 0;background:#161b22;
        border:1px solid #30363d;color:#c9d1d9;border-radius:6px;font-family:inherit}
  button{padding:9px 20px;background:#238636;color:#fff;border:0;border-radius:6px;
         cursor:pointer;font-family:inherit;margin-top:4px}
  .msg{padding:10px 12px;margin:14px 0;border-left:3px solid #f85149;background:#161b22;
       border-radius:0 6px 6px 0;font-size:14px}
  .ok{border-left-color:#3fb950}
  .flag{padding:12px;margin:14px 0;border:1px solid #3fb950;background:#0f1f14;
        border-radius:6px;color:#3fb950;word-break:break-all}
</style>
<h2>&#128274; SecureVault</h2>
<p class="sub">internal staff login</p>
<div class="mode">
  <a href="/?mode=easy" class="{{ 'active' if mode=='easy' else '' }}">EASY</a>
  <a href="/?mode=hard" class="{{ 'active' if mode=='hard' else '' }}">HARD</a>
</div>
<p class="hint">{{ hint|safe }}</p>
{% if message %}<div class="msg {{ 'ok' if ok else '' }}">{{ message }}</div>{% endif %}
{% if flag %}<div class="flag">&#127937; {{ flag }}</div>{% endif %}
<form method="post" action="/login?mode={{ mode }}">
  <input name="username" placeholder="username" autocomplete="off">
  <input name="password" placeholder="password" autocomplete="off">
  <button type="submit">Sign in</button>
</form>
"""


def init_db() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DROP TABLE IF EXISTS users")
    conn.execute(
        "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password TEXT, role TEXT)"
    )
    conn.executemany(
        "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
        [("guest", "guest123", "user"), ("admin", ADMIN_SECRET, "admin")],
    )
    conn.commit()
    conn.close()


def clean_mode(raw: str | None) -> str:
    return raw if raw in ("easy", "hard") else "easy"


def waf_hit(*values: str) -> bool:
    joined = " ".join(values).lower()
    return any(b in joined for b in BANNED)


def maybe_decode(value: str) -> str:
    """Undo a base64 wrapper if the value is one. This is the unwrap step
    the filter never sees: it inspects the wrapper, not what's inside it."""
    padded = value + "=" * (-len(value) % 4)
    try:
        return base64.b64decode(padded, validate=True).decode("utf-8")
    except Exception:
        return value


def render(mode: str, message: str | None = None, ok: bool = False, flag: str | None = None):
    return render_template_string(PAGE, mode=mode, hint=HINTS[mode], message=message, ok=ok, flag=flag)


@app.route("/", methods=["GET"])
def index():
    return render(clean_mode(request.args.get("mode")))


@app.route("/login", methods=["POST"])
def login():
    mode = clean_mode(request.args.get("mode"))
    username = request.form.get("username", "")
    password = request.form.get("password", "")

    if mode == "hard":
        if waf_hit(username, password):
            return render(mode, message="blocked: suspicious characters detected", ok=False)
        username = maybe_decode(username)
        password = maybe_decode(password)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    # The vulnerability: values go straight into the query text. Identical in
    # both modes -- HARD only changes what has to arrive before this line runs.
    query = f"SELECT * FROM users WHERE username = '{username}' AND password = '{password}'"
    try:
        rows = conn.execute(query).fetchall()
    except sqlite3.Error as exc:
        conn.close()
        return render(mode, message=f"query failed: {exc}", ok=False)
    conn.close()

    if not rows:
        return render(mode, message="invalid credentials", ok=False)
    # A blanket bypass (' OR '1'='1) returns every row, guest included -- show
    # whichever matched row is actually the admin, not just the first one.
    admin_row = next((r for r in rows if r["role"] == "admin"), None)
    if admin_row:
        return render(mode, message=f"welcome back, {admin_row['username']}.", ok=True, flag=FLAG)
    return render(mode, message=f"welcome, {rows[0]['username']} (not an admin account)", ok=True)


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=8080)
