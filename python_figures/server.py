"""Local-only HTTP bridge between the dashboard and Matplotlib."""

from __future__ import annotations

import json
import os
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Event, Lock, Thread
from uuid import uuid4

from publication import render_publication_figure
from ml_analysis import run_first_phase
from bidirectional_analysis import run_bidirectional
from task1_similarity import SimilarityAnalysisCancelled, run_task1_similarity
from task2_heterogeneity import HeterogeneityAnalysisCancelled, run_task2_heterogeneity
from continuous_color_distances import AnalysisCancelled, render_continuous_distance_figure, run_continuous_distances


HOST = "127.0.0.1"
PORT = int(os.environ.get("FIGURE_PORT", "8767"))
MAX_BODY = 100 * 1024 * 1024
JOBS: dict[str, dict[str, object]] = {}
JOBS_LOCK = Lock()
CONTINUOUS_CACHE: dict[str, dict[str, object]] = {}
CACHE_VERSION = "continuous-inference-v3"


def _run_continuous_job(job_id: str, payload: dict[str, object], cancel_event: Event, cache_key: str) -> None:
    def update(stage: str, completed: int, total: int) -> None:
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            if job is not None:
                job.update({"stage": stage, "completed": completed, "total": total})
    try:
        result = run_continuous_distances(payload, progress=update, cancelled=cancel_event.is_set)
        with JOBS_LOCK:
            JOBS[job_id].update({"status": "completed", "stage": "完成", "result": result})
            CONTINUOUS_CACHE[cache_key] = result
            while len(CONTINUOUS_CACHE) > 3:
                CONTINUOUS_CACHE.pop(next(iter(CONTINUOUS_CACHE)))
    except AnalysisCancelled as error:
        with JOBS_LOCK:
            JOBS[job_id].update({"status": "cancelled", "stage": "已取消", "error": str(error)})
    except Exception as error:
        print(f"[python-figures] ERROR continuous job {job_id}: {type(error).__name__}: {error}", flush=True)
        with JOBS_LOCK:
            JOBS[job_id].update({"status": "failed", "stage": "失败", "error": str(error)})


def _run_similarity_job(job_id: str, payload: dict[str, object], cancel_event: Event) -> None:
    def update(stage: str, completed: int, total: int) -> None:
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            if job is not None:
                job.update({"stage": stage, "completed": completed, "total": total})
    try:
        result = run_task1_similarity(payload, progress=update, cancelled=cancel_event.is_set)
        with JOBS_LOCK:
            JOBS[job_id].update({"status": "completed", "stage": "完成", "result": result})
    except SimilarityAnalysisCancelled as error:
        with JOBS_LOCK:
            JOBS[job_id].update({"status": "cancelled", "stage": "已取消", "error": str(error)})
    except Exception as error:
        print(f"[python-figures] ERROR similarity job {job_id}: {type(error).__name__}: {error}", flush=True)
        with JOBS_LOCK:
            JOBS[job_id].update({"status": "failed", "stage": "失败", "error": str(error)})


def _run_heterogeneity_job(job_id: str, payload: dict[str, object], cancel_event: Event) -> None:
    def update(stage: str, completed: int, total: int) -> None:
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            if job is not None:
                job.update({"stage": stage, "completed": completed, "total": total})
    try:
        result = run_task2_heterogeneity(payload, progress=update, cancelled=cancel_event.is_set)
        with JOBS_LOCK:
            JOBS[job_id].update({"status": "completed", "stage": "完成", "result": result})
    except HeterogeneityAnalysisCancelled as error:
        with JOBS_LOCK:
            JOBS[job_id].update({"status": "cancelled", "stage": "已取消", "error": str(error)})
    except Exception as error:
        print(f"[python-figures] ERROR heterogeneity job {job_id}: {type(error).__name__}: {error}", flush=True)
        with JOBS_LOCK:
            JOBS[job_id].update({"status": "failed", "stage": "失败", "error": str(error)})


class FigureHandler(BaseHTTPRequestHandler):
    server_version = "ChromalabPythonFigures/1.0"

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")

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
        elif self.path.startswith("/continuous-distance-jobs/") or self.path.startswith("/task1-similarity-jobs/") or self.path.startswith("/task2-heterogeneity-jobs/"):
            job_id = self.path.rsplit("/", 1)[-1]
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                payload = None if job is None else {key: value for key, value in job.items() if key != "cancelEvent"}
            self._json(404 if payload is None else 200, {"ok": False, "message": "任务不存在"} if payload is None else payload)
        else:
            self._json(404, {"ok": False, "message": "Not found"})

    def do_DELETE(self) -> None:
        if not (self.path.startswith("/continuous-distance-jobs/") or self.path.startswith("/task1-similarity-jobs/") or self.path.startswith("/task2-heterogeneity-jobs/")):
            self._json(404, {"ok": False, "message": "Not found"}); return
        job_id = self.path.rsplit("/", 1)[-1]
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            if job is None:
                self._json(404, {"ok": False, "message": "任务不存在"}); return
            cancel_event = job.get("cancelEvent")
            if isinstance(cancel_event, Event):
                cancel_event.set()
        self._json(200, {"ok": True, "status": "cancelling"})

    def do_POST(self) -> None:
        if self.path not in {"/render", "/ml-analysis", "/bidirectional-analysis", "/task1-similarity", "/task1-similarity-jobs", "/task2-heterogeneity-jobs", "/continuous-distances", "/continuous-distance-jobs", "/continuous-distance-figure"}:
            self._json(404, {"ok": False, "message": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                raise ValueError("请求数据为空或超过 100 MB。")
            payload = json.loads(self.rfile.read(length))
            if self.path == "/continuous-distance-jobs":
                job_id = uuid4().hex
                cancel_event = Event()
                cache_source = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                cache_key = hashlib.sha256(f"{CACHE_VERSION}:{cache_source}".encode("utf-8")).hexdigest()
                with JOBS_LOCK:
                    cached = CONTINUOUS_CACHE.get(cache_key)
                    if cached is not None:
                        JOBS[job_id] = {"jobId": job_id, "status": "completed", "stage": "已命中结果缓存", "completed": 1, "total": 1, "result": cached, "cancelEvent": cancel_event}
                    else:
                        JOBS[job_id] = {"jobId": job_id, "status": "running", "stage": "排队", "completed": 0, "total": 1, "cancelEvent": cancel_event}
                if cached is None:
                    Thread(target=_run_continuous_job, args=(job_id, payload, cancel_event, cache_key), daemon=True).start()
                self._json(202, {"jobId": job_id, "status": "completed" if cached is not None else "running", "cached": cached is not None})
                return
            if self.path == "/task1-similarity-jobs":
                job_id = uuid4().hex
                cancel_event = Event()
                with JOBS_LOCK:
                    JOBS[job_id] = {"jobId": job_id, "status": "running", "stage": "排队", "completed": 0, "total": 1, "cancelEvent": cancel_event}
                Thread(target=_run_similarity_job, args=(job_id, payload, cancel_event), daemon=True).start()
                self._json(202, {"jobId": job_id, "status": "running"})
                return
            if self.path == "/task2-heterogeneity-jobs":
                job_id = uuid4().hex
                cancel_event = Event()
                with JOBS_LOCK:
                    JOBS[job_id] = {"jobId": job_id, "status": "running", "stage": "排队", "completed": 0, "total": 1, "cancelEvent": cancel_event}
                Thread(target=_run_heterogeneity_job, args=(job_id, payload, cancel_event), daemon=True).start()
                self._json(202, {"jobId": job_id, "status": "running"})
                return
            if self.path == "/ml-analysis":
                result = run_first_phase(payload)
                self._json(200, result)
                return
            if self.path == "/bidirectional-analysis":
                result = run_bidirectional(payload)
                self._json(200, result)
                return
            if self.path == "/task1-similarity":
                result = run_task1_similarity(payload)
                self._json(200, result)
                return
            if self.path == "/continuous-distances":
                self._json(200, run_continuous_distances(payload))
                return
            if self.path == "/continuous-distance-figure":
                image = render_continuous_distance_figure(payload)
                image_format = str(payload.get("format", "png")).lower()
                self.send_response(200)
                self.send_header("Content-Type", "image/svg+xml" if image_format == "svg" else "image/png")
                self.send_header("Content-Length", str(len(image)))
                self.send_header("Cache-Control", "no-store")
                self._cors(); self.end_headers(); self.wfile.write(image)
                return
            image = render_publication_figure(payload)
            options = payload.get("options", {}) if isinstance(payload, dict) else {}
            image_format = str(options.get("format", "png")).lower()
            self.send_response(200)
            self.send_header("Content-Type", "image/svg+xml" if image_format == "svg" else "image/png")
            self.send_header("Content-Length", str(len(image)))
            self.send_header("Cache-Control", "no-store")
            self._cors()
            self.end_headers()
            self.wfile.write(image)
        except Exception as error:
            print(f"[python-figures] ERROR {self.path}: {type(error).__name__}: {error}", flush=True)
            self._json(400, {"ok": False, "message": str(error)})

    def log_message(self, format: str, *args: object) -> None:
        print(f"[python-figures] {self.address_string()} {format % args}", flush=True)


if __name__ == "__main__":
    print(f"Python figure service: http://{HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), FigureHandler).serve_forever()
