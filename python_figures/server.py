"""Local-only HTTP bridge between the dashboard and Matplotlib."""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from hsvplot import render_hsv_figure


HOST = "127.0.0.1"
PORT = 8765
MAX_BODY = 20 * 1024 * 1024


class FigureHandler(BaseHTTPRequestHandler):
    server_version = "ChromalabPythonFigures/1.0"

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _json(self, status: int, payload: dict[str, object]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json(200, {"ok": True, "renderer": "matplotlib"})
        else:
            self._json(404, {"ok": False, "message": "Not found"})

    def do_POST(self) -> None:
        if self.path != "/render":
            self._json(404, {"ok": False, "message": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                raise ValueError("绘图数据为空或超过 20 MB。")
            payload = json.loads(self.rfile.read(length))
            image = render_hsv_figure(payload)
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(image)))
            self.send_header("Cache-Control", "no-store")
            self._cors()
            self.end_headers()
            self.wfile.write(image)
        except Exception as error:
            self._json(400, {"ok": False, "message": str(error)})

    def log_message(self, format: str, *args: object) -> None:
        print(f"[python-figures] {self.address_string()} {format % args}", flush=True)


if __name__ == "__main__":
    print(f"Python figure service: http://{HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), FigureHandler).serve_forever()

