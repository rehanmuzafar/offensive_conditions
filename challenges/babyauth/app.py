"""babyauth — a cookie the client is trusted with, which is the bug.

The flag is never baked into this image. It arrives per instance in CTF_FLAG,
so the copy one team solves is not the copy another team can be handed.
"""
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

FLAG = os.environ.get("CTF_FLAG", "OFFCON{local-run-no-flag-injected}")
PORT = int(os.environ.get("PORT", "8080"))

PAGE = b"""<!doctype html><title>babyauth</title>
<h1>babyauth</h1>
<p>Members only. You are browsing as <b>guest</b>.</p>
<p><small>Set-Cookie: role=guest</small></p>
"""


class Handler(BaseHTTPRequestHandler):
    # The default logger writes to stderr on every hit; quiet is kinder to
    # whoever reads `docker logs` looking for a real fault.
    def log_message(self, *args):
        pass

    def do_GET(self):
        cookie = self.headers.get("Cookie", "")
        role = ""
        for part in cookie.split(";"):
            k, _, v = part.strip().partition("=")
            if k == "role":
                role = v
        if role == "admin":
            body = f"<h1>babyauth</h1><p>Welcome back, admin.</p><pre>{FLAG}</pre>".encode()
        else:
            body = PAGE
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Set-Cookie", "role=guest; Path=/")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
