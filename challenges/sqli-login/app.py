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
  :root{
    --bg:#050108; --panel:#0d0518; --purple:#a855f7; --purple-dim:#7c3aed;
    --purple-glow:rgba(168,85,247,.45); --border:rgba(168,85,247,.35);
    --text:#ede9fe; --text-dim:#a78bda; --text-faint:#6b5b8f;
    --pink:#f0abfc; --danger:#fb7185; --danger-glow:rgba(251,113,133,.4);
  }
  *{box-sizing:border-box}
  body{
    font-family:ui-monospace,Menlo,Consolas,monospace;background:var(--bg);color:var(--text);
    min-height:100vh;margin:0;padding:40px 16px;display:flex;align-items:center;justify-content:center;
    background-image:
      linear-gradient(rgba(168,85,247,.08) 1px,transparent 1px),
      linear-gradient(90deg,rgba(168,85,247,.08) 1px,transparent 1px);
    background-size:34px 34px;
    background-position:center;
  }
  .card{
    width:100%;max-width:480px;background:linear-gradient(180deg,var(--panel),#080311);
    border:1px solid var(--border);border-radius:14px;padding:32px 28px;
    box-shadow:0 0 0 1px rgba(168,85,247,.08),0 0 40px rgba(168,85,247,.16),
               inset 0 1px 0 rgba(255,255,255,.03);
  }
  .prompt{color:var(--text-faint);font-size:12px;letter-spacing:.06em;margin:0 0 6px}
  .prompt .cur{display:inline-block;width:7px;height:13px;background:var(--purple);
               margin-left:2px;vertical-align:-2px;animation:blink 1.1s step-end infinite}
  @keyframes blink{50%{opacity:0}}
  h2{
    margin:0 0 2px;font-size:26px;letter-spacing:.02em;color:#fff;
    text-shadow:0 0 10px var(--purple-glow),0 0 24px rgba(168,85,247,.35);
  }
  .sub{color:var(--text-dim);font-size:13px;margin:0 0 20px}
  .mode{display:flex;gap:8px;margin-bottom:16px}
  .mode a{
    flex:1;text-align:center;padding:8px 0;border:1px solid var(--border);text-decoration:none;
    color:var(--text-dim);border-radius:8px;font-size:12px;letter-spacing:.1em;font-weight:600;
    transition:all .15s;
  }
  .mode a:hover{border-color:var(--purple);color:var(--text)}
  .mode a.active{
    background:linear-gradient(135deg,var(--purple),var(--purple-dim));border-color:var(--purple);
    color:#fff;box-shadow:0 0 18px var(--purple-glow);
  }
  .hint{color:var(--text-dim);font-size:12.5px;line-height:1.7;margin:0 0 20px;
        border-left:2px solid var(--border);padding-left:10px}
  code{background:rgba(168,85,247,.12);color:var(--pink);padding:1px 6px;border-radius:4px;
       border:1px solid rgba(168,85,247,.2)}
  input{
    width:100%;padding:11px 12px;margin:0 0 10px;background:#0a0512;
    border:1px solid var(--border);color:var(--text);border-radius:8px;font-family:inherit;
    font-size:14px;transition:all .15s;
  }
  input::placeholder{color:var(--text-faint)}
  input:focus{
    outline:none;border-color:var(--purple);
    box-shadow:0 0 0 3px rgba(168,85,247,.15),0 0 16px rgba(168,85,247,.25);
  }
  button{
    width:100%;padding:11px 20px;margin-top:4px;
    background:linear-gradient(135deg,var(--purple) 0%,var(--purple-dim) 100%);
    color:#fff;border:0;border-radius:8px;cursor:pointer;font-family:inherit;font-size:14px;
    font-weight:600;letter-spacing:.04em;box-shadow:0 0 18px var(--purple-glow);
    transition:transform .1s,box-shadow .15s;
  }
  button:hover{box-shadow:0 0 28px rgba(168,85,247,.6);transform:translateY(-1px)}
  button:active{transform:translateY(0)}
  .msg{
    padding:10px 14px;margin:0 0 16px;border-radius:8px;font-size:13.5px;
    border:1px solid rgba(251,113,133,.4);background:rgba(251,113,133,.08);color:var(--danger);
    box-shadow:0 0 14px var(--danger-glow);
  }
  .msg.ok{
    border-color:rgba(168,85,247,.4);background:rgba(168,85,247,.08);color:var(--text);
    box-shadow:0 0 14px var(--purple-glow);
  }
  .flag{
    padding:14px;margin:0 0 18px;border-radius:8px;word-break:break-all;font-size:14px;
    color:#fff;text-align:center;font-weight:600;letter-spacing:.02em;
    border:1px solid rgba(217,70,239,.55);
    background:linear-gradient(135deg,rgba(168,85,247,.16),rgba(217,70,239,.1));
    box-shadow:0 0 26px rgba(217,70,239,.35),inset 0 0 20px rgba(168,85,247,.08);
    animation:pulse 2s ease-in-out infinite;
  }
  @keyframes pulse{
    0%,100%{box-shadow:0 0 20px rgba(217,70,239,.28),inset 0 0 16px rgba(168,85,247,.06)}
    50%{box-shadow:0 0 34px rgba(217,70,239,.5),inset 0 0 24px rgba(168,85,247,.12)}
  }
</style>
<div class="card">
  <p class="prompt">root@securevault:~$ authenticate<span class="cur"></span></p>
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
</div>
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
