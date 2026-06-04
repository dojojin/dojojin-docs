#!/usr/bin/env python3
# ============================================================
# DojoJin Tech Dashboard — Phase 6.0 Spike FTP Server
# Verifies that Bosch cameras can push pre-alarm clips from RAM
# buffer to FTP without requiring a microSD card.
#
# Logs every connect / login / file upload with timestamp + size.
# Files land in ../media-spike/ (gitignored).
#
# Install:  pip3 install pyftpdlib
# Run:      python3 tools/ftp-spike-server.py [port]
# ============================================================

import os, sys, time

try:
    from pyftpdlib.authorizers import DummyAuthorizer
    from pyftpdlib.handlers import FTPHandler
    from pyftpdlib.servers import FTPServer
except ImportError:
    sys.stderr.write(
        "ERROR: pyftpdlib not installed.\n"
        "  Run: pip3 install pyftpdlib\n"
    )
    sys.exit(1)

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 2121
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'media-spike'))
USER = 'bosch'
PASS = 'spike-2026'

os.makedirs(ROOT, exist_ok=True)


def stamp():
    return time.strftime('%H:%M:%S')


class LoggingFTPHandler(FTPHandler):
    def on_connect(self):
        print(f"[{stamp()}] · connect       from {self.remote_ip}:{self.remote_port}")

    def on_login(self, username):
        print(f"[{stamp()}] · login OK      user={username}")

    def on_login_failed(self, username, password):
        print(f"[{stamp()}] ✗ login FAILED  user={username}")

    def on_file_received(self, file):
        size = os.path.getsize(file)
        print(f"[{stamp()}] ✓ FILE RECEIVED  {os.path.basename(file)}  "
              f"({size:,} bytes, {size/1_048_576:.2f} MB)")

    def on_disconnect(self):
        print(f"[{stamp()}] · disconnect")


def main():
    authorizer = DummyAuthorizer()
    authorizer.add_user(USER, PASS, ROOT, perm='elradfmwMT')
    LoggingFTPHandler.authorizer = authorizer
    LoggingFTPHandler.banner = "DojoJin Spike FTP Ready"

    server = FTPServer(('0.0.0.0', PORT), LoggingFTPHandler)
    server.max_cons = 32

    bar = '─' * 60
    print(bar)
    print(f"  DojoJin Phase 6.0 Spike FTP Server")
    print(bar)
    print(f"  bind:   0.0.0.0:{PORT}")
    print(f"  user:   {USER}")
    print(f"  pass:   {PASS}")
    print(f"  root:   {ROOT}")
    print()
    print(f"  Camera FTP target →  {USER}@<MacBook IP>:{PORT}")
    print(f"  Files arriving will be logged below.")
    print(bar)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[shutdown] FTP server stopped")


if __name__ == '__main__':
    main()
