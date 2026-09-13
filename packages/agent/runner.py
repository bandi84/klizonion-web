from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import signal
import threading
import time
import uuid
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    import psutil
except ImportError:
    psutil = None

MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_LIST_ENTRIES = 1000
ALLOWED_COMMANDS = {
    "git.status": ["git", "status", "--short", "--branch"],
    "git.diff": ["git", "diff", "--stat"],
    "git.log": ["git", "log", "-5", "--oneline"],
    "build.run": ["npm", "run", "build"],
    "test.run": ["python", "-m", "pytest"],
}


def hardware() -> dict:
    return {
        "os": platform.platform(),
        "cpu": platform.processor() or "unknown",
        "cores": os.cpu_count(),
        "ram_gb": round(psutil.virtual_memory().total / 2**30, 1) if psutil else None,
    }


def workspace_path(root: Path, relative: str) -> Path:
    if not relative or Path(relative).is_absolute():
        raise ValueError("A workspace-relative path is required")
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError("Path escapes the authorized workspace") from exc
    return candidate


def safe_command(argv: list[str], workspace: Path) -> dict:
    if not argv or argv not in ALLOWED_COMMANDS.values():
        raise ValueError("Command is not allowlisted")
    started = time.monotonic()
    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
    try:
        process = subprocess.Popen(
            argv,
            cwd=workspace,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=creationflags,
            start_new_session=sys.platform != "win32",
        )
    except OSError as exc:
        return {
            "ok": False,
            "status": "unavailable",
            "returncode": None,
            "stdout": "",
            "stderr": str(exc),
            "output": str(exc),
            "durationMs": round((time.monotonic() - started) * 1000),
        }
    try:
        stdout, stderr = process.communicate(timeout=300)
    except subprocess.TimeoutExpired as exc:
        if sys.platform == "win32":
            process.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            os.killpg(process.pid, signal.SIGTERM)
        try:
            stdout, stderr = process.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            if sys.platform == "win32":
                process.kill()
            else:
                os.killpg(process.pid, signal.SIGKILL)
            stdout, stderr = process.communicate()
        raise TimeoutError("Allowlisted command exceeded the 300 second timeout") from exc
    duration_ms = round((time.monotonic() - started) * 1000)
    return {
        "ok": process.returncode == 0,
        "status": "passed" if process.returncode == 0 else "failed",
        "returncode": process.returncode,
        "stdout": stdout[-12000:],
        "stderr": stderr[-12000:],
        "output": stdout[-12000:] if process.returncode == 0 else stderr[-12000:],
        "durationMs": duration_ms,
    }


def list_workspace(root: Path) -> dict:
    entries = []
    for path in sorted(root.rglob("*")):
        if ".git" in path.parts:
            continue
        relative = path.relative_to(root).as_posix()
        entries.append({"path": relative, "type": "directory" if path.is_dir() else "file"})
        if len(entries) >= MAX_LIST_ENTRIES:
            break
    return {"workspace": str(root), "entries": entries, "truncated": len(entries) >= MAX_LIST_ENTRIES}


def execute_action(action: dict, root: Path) -> dict:
    operation = action.get("operation")
    payload = action.get("payload") or {}

    if operation == "workspace.list":
        return list_workspace(root)
    if operation in ALLOWED_COMMANDS:
        return safe_command(ALLOWED_COMMANDS[operation], root)
    if operation == "file.read":
        path = workspace_path(root, str(payload.get("path", "")))
        data = path.read_bytes()
        if len(data) > MAX_FILE_BYTES:
            raise ValueError("File is larger than the structured read limit")
        return {"path": path.relative_to(root).as_posix(), "content": data.decode("utf-8")}
    if operation in {"file.write", "file.patch"}:
        path = workspace_path(root, str(payload.get("path", "")))
        content = payload.get("content")
        if not isinstance(content, str):
            raise ValueError("Structured file writes require string content")
        if len(content.encode("utf-8")) > MAX_FILE_BYTES:
            raise ValueError("File is larger than the structured write limit")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8", newline="")
        return {
            "path": path.relative_to(root).as_posix(),
            "bytes": len(content.encode("utf-8")),
            "contentPreview": content[:8192],
        }
    if operation == "directory.create":
        path = workspace_path(root, str(payload.get("path", "")))
        path.mkdir(parents=True, exist_ok=True)
        return {"path": path.relative_to(root).as_posix(), "created": True}
    if operation == "preview.start":
        return {"ok": False, "status": "unavailable", "error": "Preview hosting is not configured for this runner."}
    if operation == "preview.status":
        return {"ok": False, "status": "unavailable", "error": "Preview hosting is not configured for this runner."}
    if operation == "evaluation.run":
        return {"ok": False, "status": "unavailable", "error": "Evaluation is performed by the Worker evaluator."}
    if operation == "experiment.record":
        return {"ok": False, "status": "unavailable", "error": "Experiment storage is not configured for this runner."}

    raise ValueError(f"Operation is not allowlisted: {operation}")


def request_json(url: str, secret: str, payload: dict) -> dict:
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "x-runner-secret": secret,
        },
        method="POST",
    )
    with urlopen(request, timeout=35) as response:
        return json.loads(response.read().decode("utf-8"))


def heartbeat(worker_url: str, secret: str, root: Path, status: str, runner_id: str) -> dict:
    return request_json(
        f"{worker_url.rstrip('/')}/api/runner/heartbeat",
        secret,
        {"hardware": hardware(), "workspace": str(root), "status": status, "runnerId": runner_id},
    )

def report_result(worker_url: str, secret: str, action: dict, success: bool, result=None, error=None, runner_status="READY") -> None:
    request_json(
        f"{worker_url.rstrip('/')}/api/runner/result",
        secret,
        {
            "missionId": action.get("missionId"),
            "actionId": action.get("actionId"),
            "success": success,
            "result": result,
            "error": error,
            "runnerStatus": runner_status,
            "runnerId": action.get("runnerId"),
            "workspaceId": action.get("workspaceId"),
        },
    )


def run(args: argparse.Namespace, stop_event: threading.Event) -> None:
    root = Path(args.workspace).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    worker_url = args.worker_url or os.environ.get("KLIZONION_WORKER_URL")
    secret = os.environ.get("RUNNER_SHARED_SECRET")
    runner_id = args.runner_id or os.environ.get("KLIZONION_RUNNER_ID") or f"runner_{uuid.uuid4().hex}"
    if not worker_url or not secret:
        raise SystemExit("KLIZONION_WORKER_URL and RUNNER_SHARED_SECRET are required")

    print(json.dumps({"event": "runner_ready", "workspace": str(root), "hardware": hardware()}), flush=True)
    runner_status = "READY"
    while not stop_event.is_set():
        try:
            payload = heartbeat(worker_url, secret, root, runner_status, runner_id)
            runner_status = "READY"
            for action in payload.get("pendingActions", []):
                runner_status = "BUSY"
                action["runnerId"] = runner_id
                action["workspaceId"] = payload.get("workspaceId")
                try:
                    result = execute_action(action, root)
                    report_result(worker_url, secret, action, True, result=result, runner_status="READY")
                    print(json.dumps({"event": "action_completed", "actionId": action.get("actionId"), "operation": action.get("operation")}), flush=True)
                except Exception as exc:
                    runner_status = "ERROR"
                    report_result(worker_url, secret, action, False, error=str(exc), runner_status=runner_status)
                    print(json.dumps({"event": "action_failed", "actionId": action.get("actionId"), "error": str(exc)}), flush=True)
        except (HTTPError, URLError, TimeoutError, ValueError) as exc:
            runner_status = "RECONNECTING"
            print(json.dumps({"event": "runner_connection_error", "error": str(exc)}), flush=True)
        stop_event.wait(args.interval)

    print(json.dumps({"event": "runner_stopped"}), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="KLIZONION supervised structured runner")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--worker-url", default=None)
    parser.add_argument("--runner-id", default=None)
    parser.add_argument("--interval", type=float, default=3.0)
    stop_event = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stop_event.set())
    signal.signal(signal.SIGTERM, lambda *_: stop_event.set())
    run(parser.parse_args(), stop_event)


if __name__ == "__main__":
    main()
