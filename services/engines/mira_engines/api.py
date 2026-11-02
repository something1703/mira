"""FastAPI layer: the only I/O in mira-engines (endpoints per docs/ENGINES.md §10)."""

from __future__ import annotations

import base64
import binascii
import io
import json
import logging
import os
import re
import sys
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import asdict
from typing import Annotated, Any, Literal

import numpy as np
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from mira_engines import (
    ENGINE_VERSION,
    audit,
    brand,
    colour,
    config,
    garment,
    look,
    phantom,
    shade,
    stats,
)
from mira_engines.faces import FaceDetectorUnavailable, detect_face_box

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


# ---------------------------------------------------------------------------
# Endpoints (docs/ENGINES.md §10). Every response carries the engine version and the thresholds it
# used, so a result can be reproduced.
# ---------------------------------------------------------------------------

# CIELAB, D65, 2° observer. Real colours sit well inside these bounds; outside is a mistake.
_L = Annotated[float, Field(ge=0, le=100)]
_AB = Annotated[float, Field(ge=-200, le=200)]
LabIn = Annotated[tuple[_L, _AB, _AB], Field(description="CIELAB, D65, 2° observer")]
# YouCam raw scores run 1-100 (docs/YOUCAM_API.md §3).
RawScore = Annotated[float, Field(ge=0, le=100)]


class Strict(BaseModel):
    """Requests are read as JSON in strict mode (D28): no coercion of `"0"` or `true` into a number,
    no NaN or infinity, no field that is not declared."""

    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


def strict_body[M: Strict](model: type[M]) -> Callable[[Request], Awaitable[M]]:
    """A dependency that parses the request body as strict JSON, as TypeScript's Zod already did.

    FastAPI's own body parsing validates a Python object, where strict mode rejects a JSON array for
    a tuple. Reading the JSON text itself keeps strict mode and arrays together.
    """

    async def read(request: Request) -> M:
        raw = await request.body()
        try:
            return model.model_validate_json(raw, strict=True)
        except ValidationError as err:
            # The input is left out of the answer: it may be a person's colour readings.
            detail = err.errors(include_url=False, include_context=False, include_input=False)
            raise HTTPException(422, jsonable(detail)) from err

    return read


def jsonable(errors: list[Any]) -> list[dict[str, Any]]:
    return [{"loc": [str(p) for p in e["loc"]], "msg": e["msg"], "type": e["type"]} for e in errors]


def envelope(result: object) -> dict[str, object]:
    return {"engine_version": ENGINE_VERSION, "config": config.snapshot(), "result": result}


class HexList(Strict):
    hex: list[str] = Field(min_length=1, max_length=500)


@app.post("/colour/lab")
def colour_lab(body: Annotated[HexList, Depends(strict_body(HexList))]) -> dict[str, object]:
    out = []
    for value in body.hex:
        try:
            lab = colour.hex_to_lab(value)
        except ValueError as err:
            raise HTTPException(422, str(err)) from err
        ita = colour.ita_degrees(lab)
        light, chroma, hue = colour.lab_to_lch(lab)
        out.append(
            {
                "hex": value,
                "lab": lab,
                "lch": {"l": light, "c": chroma, "h": hue},
                "ita": ita,
                "ita_band": colour.ita_band(ita),
            }
        )
    return envelope(out)


class LabPairs(Strict):
    pairs: list[tuple[LabIn, LabIn]] = Field(min_length=1, max_length=10_000)


@app.post("/colour/de2000")
def colour_de2000(body: Annotated[LabPairs, Depends(strict_body(LabPairs))]) -> dict[str, object]:
    first = np.array([p[0] for p in body.pairs])
    second = np.array([p[1] for p in body.pairs])
    return envelope(colour.de2000_vec(first, second).tolist())


class ShadeIn(Strict):
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(max_length=200)
    lab: LabIn

    def to_shade(self) -> shade.Shade:
        return shade.Shade(self.id, self.name, self.lab)


class PrerankIn(Strict):
    skin: LabIn
    catalogue: list[ShadeIn] = Field(min_length=1, max_length=5_000)


@app.post("/shade/prerank")
def shade_prerank(body: Annotated[PrerankIn, Depends(strict_body(PrerankIn))]) -> dict[str, object]:
    ranked = shade.prerank(body.skin, [s.to_shade() for s in body.catalogue])
    return envelope(
        [
            {
                "id": r.shade.id,
                "name": r.shade.name,
                "de": r.de,
                "d_lightness": r.d_lightness,
                "d_hue": r.d_hue,
                "label": r.label,
            }
            for r in ranked
        ]
    )


class ClosedLoopIn(Strict):
    skin: LabIn
    shade: LabIn
    render: LabIn


@app.post("/shade/closed-loop")
def shade_closed_loop(
    body: Annotated[ClosedLoopIn, Depends(strict_body(ClosedLoopIn))],
) -> dict[str, object]:
    return envelope(asdict(shade.closed_loop(body.skin, body.shade, body.render)))


class FinishIn(Strict):
    skin_type_whole: str | None = None
    concern_raw_scores: dict[str, RawScore] = Field(default_factory=dict)


@app.post("/shade/finish")
def shade_finish(body: Annotated[FinishIn, Depends(strict_body(FinishIn))]) -> dict[str, object]:
    return envelope(
        asdict(shade.finish_and_coverage(body.skin_type_whole, body.concern_raw_scores))
    )


class LookIn(Strict):
    garment: LabIn
    skin: LabIn
    natural_lip: LabIn
    hair: LabIn
    lips: list[ShadeIn] = Field(max_length=2_000)
    blushes: list[ShadeIn] = Field(default_factory=list, max_length=2_000)


@app.post("/look/suggest")
def look_suggest(body: Annotated[LookIn, Depends(strict_body(LookIn))]) -> dict[str, object]:
    out = look.suggest(
        garment=body.garment,
        skin=body.skin,
        natural_lip=body.natural_lip,
        hair=body.hair,
        lips=[s.to_shade() for s in body.lips],
        blushes=[s.to_shade() for s in body.blushes],
    )
    return envelope(asdict(out))


MAX_IMAGE_BYTES = 10 * 1024 * 1024  # YouCam's own input limit (docs/YOUCAM_API.md §3)
# A small file can hold an enormous picture (a solid 6000 x 6000 PNG is 152 KB). Decoding that costs
# gigabytes, so the pixel count is capped as well as the bytes.
MAX_IMAGE_PIXELS = 25_000_000
MAX_B64_CHARS = MAX_IMAGE_BYTES * 4 // 3 + 8


def decode_image(b64: str, mode: Literal["RGB", "RGBA"]) -> np.ndarray[Any, np.dtype[np.uint8]]:
    """Interim transport: base64 in the request body, until the blob port lands (Phase 3, D10)."""
    if len(b64) > MAX_B64_CHARS:
        raise HTTPException(413, "Image is larger than 10 MB")
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError) as err:
        raise HTTPException(422, "Image is not valid base64") from err
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image is larger than 10 MB")
    try:
        with Image.open(io.BytesIO(raw)) as img:
            if img.width * img.height > MAX_IMAGE_PIXELS:
                raise HTTPException(413, "Image has too many pixels; use one under 25 megapixels")
            return np.asarray(img.convert(mode), dtype=np.uint8)
    except Image.DecompressionBombError as err:
        raise HTTPException(413, "Image has too many pixels; use one under 25 megapixels") from err
    except (UnidentifiedImageError, OSError) as err:
        raise HTTPException(422, "Image could not be read") from err


class ImageIn(Strict):
    image_b64: str


@app.post("/garment/colour")
def garment_colour(body: Annotated[ImageIn, Depends(strict_body(ImageIn))]) -> dict[str, object]:
    try:
        out = garment.garment_colour(decode_image(body.image_b64, "RGBA"))
    except ValueError as err:
        raise HTTPException(422, str(err)) from err
    return envelope(asdict(out))


class FaceBoxIn(Strict):
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class AuditGarmentIn(Strict):
    source_b64: str
    render_b64: str
    garment_labs: list[LabIn] = Field(min_length=1, max_length=2)
    face_box: FaceBoxIn | None = None


@app.post("/audit/garment")
def audit_garment(
    body: Annotated[AuditGarmentIn, Depends(strict_body(AuditGarmentIn))],
) -> dict[str, object]:
    source = decode_image(body.source_b64, "RGB")
    render = decode_image(body.render_b64, "RGB")
    if body.face_box is not None:
        face: audit.FaceBox | None = audit.FaceBox(**body.face_box.model_dump())
    else:
        try:
            face = detect_face_box(source)
        except FaceDetectorUnavailable as err:
            raise HTTPException(503, "No face detector is configured; pass face_box") from err
    if face is None:
        return envelope({"label": "not_checked", "reason": "no_face"})
    try:
        out = audit.garment_audit(source, render, face, list(body.garment_labs))
    except ValueError as err:
        raise HTTPException(422, str(err)) from err
    return envelope(asdict(out))


class LipAuditIn(Strict):
    rendered: LabIn
    intended: LabIn


@app.post("/audit/lip")
def audit_lip(body: Annotated[LipAuditIn, Depends(strict_body(LipAuditIn))]) -> dict[str, object]:
    return envelope(asdict(audit.lip_audit(body.rendered, body.intended)))


class IdentityIn(Strict):
    source: list[float] = Field(min_length=1, max_length=64)
    final: list[float] = Field(min_length=1, max_length=64)


@app.post("/audit/identity")
def audit_identity(
    body: Annotated[IdentityIn, Depends(strict_body(IdentityIn))],
) -> dict[str, object]:
    try:
        return envelope(asdict(audit.identity_drift(body.source, body.final)))
    except ValueError as err:
        raise HTTPException(422, str(err)) from err


class NoiseFloorIn(Strict):
    sessions: list[list[RawScore]] = Field(min_length=1, max_length=400)
    prior_sd_day: float | None = Field(default=None, ge=0)


@app.post("/stats/noise-floor")
def stats_noise_floor(
    body: Annotated[NoiseFloorIn, Depends(strict_body(NoiseFloorIn))],
) -> dict[str, object]:
    try:
        return envelope(asdict(stats.noise_floor(body.sessions, body.prior_sd_day)))
    except ValueError as err:
        raise HTTPException(422, str(err)) from err


class ChangeIn(Strict):
    baseline: RawScore
    now: RawScore
    # A minimal detectable change of zero would call any difference a clear change, so it is
    # refused: callers pass null when it is not known.
    mdc: float | None = Field(default=None, gt=0)
    claim_direction: Literal["up", "down"]


@app.post("/stats/change")
def stats_change(body: Annotated[ChangeIn, Depends(strict_body(ChangeIn))]) -> dict[str, object]:
    return envelope(asdict(stats.change(body.baseline, body.now, body.mdc, body.claim_direction)))


class PhantomIn(Strict):
    intensities: list[float] = Field(min_length=1, max_length=50)
    scores: list[RawScore] = Field(min_length=1, max_length=50)
    mdc: float = Field(gt=0)
    invert_at: float | None = None


@app.post("/phantom/fit")
def phantom_fit(body: Annotated[PhantomIn, Depends(strict_body(PhantomIn))]) -> dict[str, object]:
    try:
        fitted = phantom.fit(body.intensities, body.scores, body.mdc)
    except ValueError as err:
        raise HTTPException(422, str(err)) from err
    result = asdict(fitted)
    if body.invert_at is not None:
        result["inverted_intensity"] = phantom.invert(fitted, body.invert_at)
    return envelope(result)


class GapIn(Strict):
    # Anonymised skin colours and a brand's shades, CIELAB. Bounded so one request cannot ask for
    # an enormous pairwise table: 5,000 colours against 400 shades is two million ΔE values.
    points: list[LabIn] = Field(min_length=1, max_length=5_000)
    shades: list[LabIn] = Field(min_length=1, max_length=400)


@app.post("/brand/gap-map")
def brand_gap_map(body: Annotated[GapIn, Depends(strict_body(GapIn))]) -> dict[str, object]:
    try:
        return envelope(asdict(brand.gap_map(list(body.points), list(body.shades))))
    except ValueError as err:
        raise HTTPException(422, str(err)) from err
