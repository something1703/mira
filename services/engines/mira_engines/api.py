"""FastAPI layer: the only I/O in mira-engines (endpoints per docs/ENGINES.md §10)."""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import uuid
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from mira_engines import ENGINE_VERSION

TRACE_HEADER = "x-mira-trace"
_TRACE_RE = re.compile(r"^trc_[a-z0-9]{6,64}$")
UNEXPECTED_ERROR_COPY = (
    "Something failed on our side. The run was stopped and no units were charged for "
    "unfinished steps."
)


class _JsonFormatter(logging.Formatter):
    """Cloud Logging-shaped JSON lines. Never logs images, URLs or keys (SECURITY_PRIVACY §6)."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "severity": record.levelname,
            "message": record.getMessage(),
            "service": "mira-engines",
            "mode": os.environ.get("MIRA_MODE", "mock"),
        }
        extra = getattr(record, "fields", None)
        if isinstance(extra, dict):
            payload.update(extra)
        return json.dumps(payload, default=str)


def _logger() -> logging.Logger:
    log = logging.getLogger("mira_engines")
    if not log.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(_JsonFormatter())
        log.addHandler(handler)
        log.setLevel(os.environ.get("LOG_LEVEL", "info").upper())
        log.propagate = False
    return log


log = _logger()
app = FastAPI(title="mira-engines", version=ENGINE_VERSION, docs_url="/docs", redoc_url=None)


def trace_id_from(incoming: str | None) -> str:
    if incoming is not None and _TRACE_RE.match(incoming):
        return incoming
    return f"trc_{uuid.uuid4().hex}"


@app.middleware("http")
async def trace(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    trace_id = trace_id_from(request.headers.get(TRACE_HEADER))
    request.state.trace_id = trace_id
    try:
        response = await call_next(request)
    except Exception:
        log.exception("unhandled error", extra={"fields": {"traceId": trace_id}})
        response = JSONResponse(
            status_code=500,
            content={"error": "unexpected", "message": UNEXPECTED_ERROR_COPY, "traceId": trace_id},
        )
    response.headers[TRACE_HEADER] = trace_id
    return response


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "ok": True,
        "service": "mira-engines",
        "mode": os.environ.get("MIRA_MODE", "mock"),
        "version": ENGINE_VERSION,
    }
