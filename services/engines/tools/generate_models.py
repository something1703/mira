"""Generates pydantic models from the JSON Schema exported by packages/schemas.

    uv run python tools/generate_models.py          # write mira_engines/models/generated/
    uv run python tools/generate_models.py --check  # fail if the committed models are stale

One module per schema, with the root class named after the schema. Zod puts a regular-expression
``pattern`` on ``date-time`` strings; pydantic cannot apply a pattern to a ``datetime`` and the
generated model would raise ``TypeError`` on first use, so the pattern is dropped *for generation
only*, and tuples are rewritten into a form the generator understands. The exported JSON Schema
is untouched and the contract test (tests/test_contract.py) checks that the models and the schema
both give the same verdicts as Zod.

Do not use the generator's ``--strict-types``: it drops range and pattern constraints (a negative
ΔE and a wrongly prefixed id were then accepted). Strictness comes from the call instead: read
payloads with ``Model.model_validate_json(raw, strict=True)``, which rejects ``"0"`` as a number.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SCHEMAS = ROOT / "mira_engines" / "schemas"
OUT = ROOT / "mira_engines" / "models" / "generated"


def adapt_for_generator(node: Any) -> Any:
    """Two rewrites, for generation only (see the module docstring).

    - ``date-time`` strings lose their ``pattern``.
    - A 2020-12 tuple (``prefixItems`` with ``items: false``) becomes the draft-07 form
      (``items: [...]``), which the generator turns into a typed ``tuple``. Without this it emits
      an untyped ``List`` that accepts ``[50, "0", 0]`` as a colour.
    """
    if isinstance(node, dict):
        out = {k: adapt_for_generator(v) for k, v in node.items()}
        if out.get("format") == "date-time":
            out.pop("pattern", None)
        if "prefixItems" in out and out.get("items") is False:
            out["items"] = out.pop("prefixItems")
        return out
    if isinstance(node, list):
        return [adapt_for_generator(v) for v in node]
    return node


def generate(into: Path) -> list[str]:
    into.mkdir(parents=True, exist_ok=True)
    names = sorted(p.stem for p in SCHEMAS.glob("*.json"))
    with tempfile.TemporaryDirectory() as tmp:
        for name in names:
            src = Path(tmp) / f"{name}.json"
            src.write_text(
                json.dumps(adapt_for_generator(json.loads((SCHEMAS / f"{name}.json").read_text())))
            )
            subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "datamodel_code_generator",
                    "--input",
                    str(src),
                    "--input-file-type",
                    "jsonschema",
                    "--output",
                    str(into / f"{name}.py"),
                    "--class-name",
                    name,
                    "--output-model-type",
                    "pydantic_v2.BaseModel",
                    "--target-python-version",
                    "3.12",
                    "--disable-timestamp",
                    "--use-annotated",
                ],
                check=True,
                capture_output=True,
            )
    lines = ['"""Generated from packages/schemas by tools/generate_models.py. Do not edit."""', ""]
    lines += [f"from mira_engines.models.generated.{n} import {n}" for n in names]
    lines += ["", "__all__ = [" + ", ".join(f'"{n}"' for n in names) + "]", ""]
    (into / "__init__.py").write_text("\n".join(lines))
    # Format like the rest of the repo so a diff means the schema changed, not the formatter.
    subprocess.run(
        [sys.executable, "-m", "ruff", "format", str(into)], check=True, capture_output=True
    )
    return names


def main() -> int:
    if "--check" not in sys.argv:
        names = generate(OUT)
        print(f"Wrote {len(names)} model modules to {OUT}")
        return 0
    with tempfile.TemporaryDirectory() as tmp:
        fresh = Path(tmp) / "generated"
        generate(fresh)
        stale = [
            p.name
            for p in sorted(fresh.iterdir())
            if not (OUT / p.name).exists() or (OUT / p.name).read_text() != p.read_text()
        ]
        stale += [p.name for p in OUT.glob("*.py") if not (fresh / p.name).exists()]
    if stale:
        print(
            "Generated models are out of date: "
            f"{', '.join(sorted(set(stale)))}. Run tools/generate_models.py."
        )
        return 1
    print("Generated models are up to date.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
