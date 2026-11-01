from fastapi.testclient import TestClient

from mira_engines.api import TRACE_HEADER, UNEXPECTED_ERROR_COPY, app

client = TestClient(app, raise_server_exceptions=False)


def test_health_answers_in_mock_mode() -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["service"] == "mira-engines"


def test_trace_id_is_propagated_or_minted() -> None:
    trace = "trc_" + "a" * 32
    assert client.get("/health", headers={TRACE_HEADER: trace}).headers[TRACE_HEADER] == trace
    minted = client.get("/health", headers={TRACE_HEADER: "<script>"}).headers[TRACE_HEADER]
    assert minted.startswith("trc_")
    assert minted != "<script>"


def test_unexpected_errors_hide_internals() -> None:
    @app.get("/_boom")
    def boom() -> None:
        raise RuntimeError("secret detail")

    res = client.get("/_boom")
    assert res.status_code == 500
    assert res.json()["message"] == UNEXPECTED_ERROR_COPY
    assert "secret detail" not in res.text
    assert res.json()["traceId"] == res.headers[TRACE_HEADER]
