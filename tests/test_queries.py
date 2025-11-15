from contextlib import contextmanager
from datetime import date
from decimal import Decimal

from app.queries import _to_float, fetch_plan_vs_fact_for_month


class DummyCursor:
    def __init__(self, *, fetchall=None, fetchone=None):
        self.fetchall_result = fetchall or []
        self.fetchone_results = list(fetchone or [])
        self.executed = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        self.executed.append((sql, params))

    def fetchall(self):
        return self.fetchall_result

    def fetchone(self):
        if self.fetchone_results:
            return self.fetchone_results.pop(0)
        return None


class DummyConnection:
    def __init__(self, cursors):
        self._cursors = list(cursors)

    def cursor(self, *args, **kwargs):
        return self._cursors.pop(0)


def test_to_float_converts_regular_numbers():
    assert _to_float(10) == 10.0
    assert _to_float("3.14") == 3.14


def test_to_float_filters_nan_and_inf():
    assert _to_float(float("nan")) is None
    assert _to_float(float("inf")) is None
    assert _to_float(Decimal("NaN")) is None
    assert _to_float(Decimal("Infinity")) is None


def test_to_float_handles_invalid_values():
    assert _to_float(None) is None
    assert _to_float("not-a-number") is None


def test_fetch_plan_vs_fact_uses_iso_month(monkeypatch):
    items_cursor = DummyCursor(fetchall=[])
    last_updated_cursor = DummyCursor(fetchone=[None])
    summary_cursor = DummyCursor(fetchone=[None])
    connection = DummyConnection([items_cursor, last_updated_cursor, summary_cursor])

    @contextmanager
    def fake_get_connection():
        yield connection

    monkeypatch.setattr("app.queries.get_connection", fake_get_connection)

    fetch_plan_vs_fact_for_month(date(2025, 11, 1))

    assert items_cursor.executed[0][1] == ("2025-11-01",)
    assert summary_cursor.executed[0][1] == ("2025-11-01",)
