"""Fuzzy matcher de transcripción contra frases del perfil activo.

- Normaliza con NFKD + drop combining + lowercase + collapse whitespace + strip puntuación.
  → "Pide HÁNGAR!" y "pide hangar" matchean perfecto.
- Scoring con `rapidfuzz.fuzz.token_set_ratio` (resistente a orden + palabras extra).
- Filtrado por idioma activo: solo evalúa `phrases_es` o `phrases_en`.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from rapidfuzz import fuzz

from .config import Command

_PUNCT_RE = re.compile(r"[^\w\s]", re.UNICODE)
_WS_RE = re.compile(r"\s+")


def normalize(text: str) -> str:
    t = text.lower().strip()
    t = unicodedata.normalize("NFKD", t)
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = _PUNCT_RE.sub(" ", t)
    return _WS_RE.sub(" ", t).strip()


@dataclass(frozen=True)
class MatchResult:
    command: Command | None
    phrase: str | None
    score: float  # 0..100; el "mejor score visto" incluso si no llegó al threshold


class IntentMatcher:
    """Indexa frases normalizadas por idioma de un set de comandos y matchea texto."""

    def __init__(self, commands: list[Command]) -> None:
        # (cmd, phrase_raw, phrase_norm, lang)
        self._es: list[tuple[Command, str, str]] = []
        self._en: list[tuple[Command, str, str]] = []
        for c in commands:
            for p in c.phrases_es:
                self._es.append((c, p, normalize(p)))
            for p in c.phrases_en:
                self._en.append((c, p, normalize(p)))

    def match(self, text: str, lang: str, threshold: int) -> MatchResult:
        pool = self._en if lang == "en" else self._es
        if not pool or not text:
            return MatchResult(None, None, 0.0)
        norm_input = normalize(text)
        best_cmd: Command | None = None
        best_phrase: str | None = None
        best_score: float = 0.0
        for cmd, phrase_raw, phrase_norm in pool:
            s = fuzz.token_set_ratio(norm_input, phrase_norm)
            if s > best_score:
                best_score = s
                best_cmd = cmd
                best_phrase = phrase_raw
        if best_score >= threshold:
            return MatchResult(best_cmd, best_phrase, best_score)
        return MatchResult(None, None, best_score)

    def preview(self, text: str, lang: str, top_n: int = 5) -> list[tuple[Command, str, float]]:
        """Top-N matches con score, ordenados desc. Útil para el slider de threshold."""
        pool = self._en if lang == "en" else self._es
        if not pool or not text:
            return []
        norm_input = normalize(text)
        scored: list[tuple[Command, str, float]] = [
            (cmd, phrase, float(fuzz.token_set_ratio(norm_input, phrase_norm)))
            for cmd, phrase, phrase_norm in pool
        ]
        scored.sort(key=lambda t: t[2], reverse=True)
        return scored[:top_n]
