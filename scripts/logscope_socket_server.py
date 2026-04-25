#!/usr/bin/env python3
"""Local logscope-frame-v1 test server.

Protocol:
  frame = uint32 big-endian payload length + UTF-8 JSON payload
  payload = {
    "version": 1,
    "recordType": "log.batch",
    "records": [{"text": "..."}]
  }
"""

from __future__ import annotations

import argparse
import json
import random
import socketserver
import struct
import threading
import time
from datetime import datetime
from typing import Iterable


LEVELS = ("INFO", "INFO", "INFO", "WARN", "ERROR")
COMPONENTS = ("auth", "matchmaker", "inventory", "gateway", "payment", "chat")
MESSAGES = (
    "request accepted",
    "cache refreshed",
    "retry budget updated",
    "player state synchronized",
    "upstream latency sampled",
    "not found fallback path used",
    "connection pool pressure changed",
)
MESSAGE_NAMES = ("LoginReq", "SyncInventory", "MatchReady", "ChangeState", "Heartbeat")


def hhmmss() -> str:
    return datetime.now().strftime("%H:%M:%S")


def make_regular_line(sequence: int, rng: random.Random) -> str:
    level = rng.choice(LEVELS)
    component = rng.choice(COMPONENTS)
    latency_ms = rng.randint(2, 950)
    request_id = f"req-{sequence:08x}"
    message = rng.choice(MESSAGES)
    if level == "ERROR":
        message = rng.choice(("failed to decode payload", "exception while applying state", message))
    return (
        f"{hhmmss()}\t{level} component={component} request_id={request_id} "
        f"latency_ms={latency_ms} worker={rng.randint(1, 12)} {message}"
    )


def make_json_marker(sequence: int, rng: random.Random) -> str:
    payload = {
        "event_name": "synthetic_marker",
        "sequence": sequence,
        "severity": rng.choice(("warn", "error", "info")),
        "request_id": f"req-{sequence:08x}",
        "tags": ["socket", "marker", rng.choice(COMPONENTS)],
        "metrics": {
            "latency_ms": rng.randint(25, 1500),
            "queue_depth": rng.randint(0, 128),
        },
    }
    return f"{hhmmss()}\t{json.dumps(payload, separators=(',', ':'))}"


def make_message_marker(sequence: int, rng: random.Random) -> list[str]:
    message_id = rng.randint(100, 999)
    direction = rng.choice(("Send", "Receive"))
    name = rng.choice(MESSAGE_NAMES)
    body = {
        "sequence": sequence,
        "message_id": message_id,
        "message_name": name,
        "direction": direction.lower(),
        "session": f"sess-{rng.randint(1000, 9999)}",
        "payload": {
            "player_id": rng.randint(10_000, 99_999),
            "marker": True,
            "state": rng.choice(("queued", "running", "settled", "failed")),
        },
    }
    return [
        f"{hhmmss()}\t============ {direction} Message ([{message_id}] {name}) ============",
        json.dumps(body, indent=2),
        "============================================",
    ]


def pack_frame(records: Iterable[str]) -> bytes:
    payload = json.dumps(
        {
            "version": 1,
            "recordType": "log.batch",
            "records": [{"text": record} for record in records],
        },
        separators=(",", ":"),
    ).encode("utf-8")
    return struct.pack(">I", len(payload)) + payload


class LogScopeHandler(socketserver.BaseRequestHandler):
    def handle(self) -> None:
        server: "LogScopeServer" = self.server  # type: ignore[assignment]
        rng = random.Random(server.seed + int(time.time() * 1000))
        sequence = 0
        print(f"client connected from {self.client_address[0]}:{self.client_address[1]}", flush=True)
        try:
            while not server.stop_event.is_set():
                batch: list[str] = []
                for _ in range(server.batch_size):
                    sequence += 1
                    if sequence % server.message_marker_every == 0:
                        batch.extend(make_message_marker(sequence, rng))
                    elif sequence % server.json_marker_every == 0:
                        batch.append(make_json_marker(sequence, rng))
                    else:
                        batch.append(make_regular_line(sequence, rng))

                self.request.sendall(pack_frame(batch))
                time.sleep(server.interval)
        except (BrokenPipeError, ConnectionResetError):
            print("client disconnected", flush=True)


class LogScopeServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

    def __init__(self, server_address: tuple[str, int], args: argparse.Namespace) -> None:
        super().__init__(server_address, LogScopeHandler)
        self.interval = args.interval
        self.batch_size = args.batch_size
        self.seed = args.seed
        self.json_marker_every = args.json_marker_every
        self.message_marker_every = args.message_marker_every
        self.stop_event = threading.Event()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a logscope-frame-v1 random log server.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--interval", type=float, default=0.08, help="seconds between batches")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--seed", type=int, default=20260425)
    parser.add_argument("--json-marker-every", type=int, default=37)
    parser.add_argument("--message-marker-every", type=int, default=91)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    with LogScopeServer((args.host, args.port), args) as server:
        print(
            f"logscope-frame-v1 server listening on {args.host}:{args.port} "
            f"batch={args.batch_size} interval={args.interval}s",
            flush=True,
        )
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            server.stop_event.set()
            print("stopping", flush=True)


if __name__ == "__main__":
    main()
