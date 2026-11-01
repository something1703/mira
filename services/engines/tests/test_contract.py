"""Contract between the TypeScript schemas and the Python engines (phases/PHASE_04).

``tests/data/contract-samples.json`` is written by ``pnpm --filter @mira/schemas
export:contract-samples``, which only writes a sample if Zod gave the verdict recorded in it. Here
the generated pydantic models and the exported JSON Schema must give the same verdict. A model that
accepts what Zod rejects (or the reverse) is a real disagreement between the two languages.
"""

from __future__ import annotations

import importlib
import json
from pathlib import Path
from typing import Any

import jsonschema
import pytest
from pydantic import BaseModel, ValidationError

HERE = Path(__file__).parent
SCHEMAS = HERE.parent / "mira_engines" / "schemas"
SAMPLES: dict[str, dict[str, Any]] = json.loads(
    (HERE / "data" / "contract-samples.json").read_text()
)


def model(name: str) -> type[BaseModel]:
    """The root model of a schema: one generated module per schema, class named after it."""
    module = importlib.import_module(f"mira_engines.models.generated.{name}")
    root: type[BaseModel] = getattr(module, name)
    return root


def strict(name: str, value: Any) -> BaseModel:
    """How the engines read TypeScript payloads: JSON text, strict (``"0"`` is not a number)."""
    return model(name).model_validate_json(json.dumps(value), strict=True)


def schema(name: str) -> dict[str, Any]:
    return json.loads((SCHEMAS / f"{name}.json").read_text())  # type: ignore[no-any-return]


def test_every_exported_schema_has_samples_and_a_model() -> None:
    exported = sorted(p.stem for p in SCHEMAS.glob("*.json"))
    assert sorted(SAMPLES) == exported
    for name in exported:
        assert model(name) is not None


@pytest.mark.parametrize("name", sorted(SAMPLES))
def test_valid_samples_are_accepted_by_models_and_json_schema(name: str) -> None:
    for i, value in enumerate(SAMPLES[name]["valid"]):
        strict(name, value)
        jsonschema.validate(value, schema(name))
        assert value is not None, f"{name} valid[{i}]"


@pytest.mark.parametrize("name", sorted(SAMPLES))
def test_invalid_samples_are_rejected_by_models_and_json_schema(name: str) -> None:
    for case in SAMPLES[name]["invalid"]:
        with pytest.raises(ValidationError):
            strict(name, case["value"])
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(case["value"], schema(name))


def test_lax_validation_would_accept_a_string_as_a_number_which_is_why_engines_read_strict() -> (
    None
):
    """Documents the pitfall: pydantic's default coerces ``"0"`` to ``0.0``; Zod never does."""
    assert model("Lab").model_validate([50, "0", 0]) is not None
    with pytest.raises(ValidationError):
        strict("Lab", [50, "0", 0])


def test_the_pattern_zod_puts_on_timestamps_is_still_enforced_by_the_json_schema() -> None:
    """The generated models drop it (pydantic cannot pattern a datetime); the schema keeps it."""
    bad = {**SAMPLES["RunEvent"]["valid"][0], "at": "yesterday"}
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(bad, schema("RunEvent"))
    with pytest.raises(ValidationError):
        strict("RunEvent", bad)
