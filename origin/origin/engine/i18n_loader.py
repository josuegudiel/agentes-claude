"""Loader de strings i18n. Compartido entre engine (para logs/errores) y UI."""
from __future__ import annotations

import json
from pathlib import Path


def load_strings(i18n_dir: Path, lang: str) -> dict[str, str]:
    path = i18n_dir / f"{lang}.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))
