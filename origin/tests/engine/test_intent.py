"""Tests del IntentMatcher."""
from __future__ import annotations

from origin.engine import config as cfgmod
from origin.engine.intent import IntentMatcher, normalize


def _cmds() -> list[cfgmod.Command]:
    return [
        cfgmod.Command(
            id="request_landing",
            phrases_es=["pide hangar", "solicita aterrizaje"],
            phrases_en=["request landing"],
            keys=["alt+n"],
        ),
        cfgmod.Command(
            id="toggle_lights",
            phrases_es=["luces"],
            phrases_en=["lights"],
            keys=["l"],
        ),
    ]


def test_normalize_strips_accents_and_punct():
    assert normalize("¡HÁNGAR!  ") == "hangar"
    assert normalize("Pide Hángar.") == "pide hangar"


def test_exact_match_es():
    m = IntentMatcher(_cmds())
    r = m.match("pide hangar", "es", 75)
    assert r.command is not None and r.command.id == "request_landing"
    assert r.score == 100.0


def test_partial_phrase_still_matches():
    m = IntentMatcher(_cmds())
    r = m.match("solicita aterrizaje por favor", "es", 75)
    assert r.command is not None and r.command.id == "request_landing"


def test_below_threshold_returns_no_match_but_keeps_score():
    m = IntentMatcher(_cmds())
    r = m.match("algo completamente distinto", "es", 75)
    assert r.command is None
    assert 0.0 <= r.score < 75


def test_active_language_filters_pool():
    m = IntentMatcher(_cmds())
    r_en = m.match("request landing", "en", 70)
    assert r_en.command is not None and r_en.command.id == "request_landing"
    # La misma frase en idioma "es" no debería matchear (no está en phrases_es).
    r_es = m.match("request landing", "es", 70)
    assert r_es.command is None


def test_accent_insensitive_match():
    m = IntentMatcher(_cmds())
    r = m.match("PÍDE HÁNGAR", "es", 75)
    assert r.command is not None and r.command.id == "request_landing"


def test_preview_returns_top_n_sorted():
    m = IntentMatcher(_cmds())
    results = m.preview("luces hangar", "es", top_n=3)
    scores = [s for _c, _p, s in results]
    assert scores == sorted(scores, reverse=True)
    assert len(results) <= 3


def test_empty_input_returns_no_match():
    m = IntentMatcher(_cmds())
    r = m.match("", "es", 75)
    assert r.command is None and r.score == 0.0
