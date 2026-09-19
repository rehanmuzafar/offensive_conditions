"""Raw TCP service -- the shape a pwn challenge takes. Reads CTF_FLAG."""
import os, socketserver

FLAG = os.environ.get("CTF_FLAG", "OFFCON{local-test-flag}")

class H(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.sendall(b"babypwn> type 'give' for the flag\n")
        data = self.request.recv(64).strip()
        if data == b"give":
            self.request.sendall(FLAG.encode() + b"\n")
        else:
            self.request.sendall(b"nope\n")

class S(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

if __name__ == "__main__":
    S(("0.0.0.0", int(os.environ.get("PORT", "9001"))), H).serve_forever()
