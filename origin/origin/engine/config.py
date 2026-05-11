"""Modelo + carga + migración + persistencia de commands.yaml.

v2: settings + profiles. Cada comando tiene phrases_es/phrases_en y labels bilingües.
v1: settings + commands plano. Se migra a v2 dentro de un perfil `default`.
"""
from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Regex compartido para ids de perfiles y comandos.
ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
# Una combinación válida es modificadores + tecla final separadas por '+', o un nombre suelto.
# Validación real (incluyendo nombre de tecla soportado) la hace keypress.parse_combo.
KEYCOMBO_RE = re.compile(r"^[a-z0-9_+]+$")


class ConfigError(Exception):
    """Error de configuración (formato, validación, versión)."""


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, frozen=True)

    ptt_key: str = "f12"
    profile_switch_hotkey: str = "ctrl+f12"
    ui_language: Literal["es", "en"] = "es"
    active_profile: str = "default"
    whisper_model: Literal["tiny", "base", "small", "medium", "large-v3"] = "small"
    whisper_device: Literal["auto", "cpu", "cuda"] = "auto"
    whisper_compute_type: Literal["auto", "int8", "int8_float16", "float16", "float32"] = "auto"
    active_language: Literal["es", "en"] = "es"
    fuzz_threshold: int = Field(default=75, ge=0, le=100)
    mic_device: int | None = None
    sample_rate: int = Field(default=16000, ge=8000, le=48000)
    max_record_seconds: int = Field(default=8, ge=1, le=60)
    inter_key_delay_ms: int = Field(default=30, ge=0, le=500)
    log_format: Literal["pretty", "json"] = "pretty"
    start_minimized: bool = False
    autostart_windows: bool = False
    theme: Literal["system", "light", "dark"] = "system"


class Command(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, frozen=True)

    id: str
    phrases_es: list[str] = Field(default_factory=list)
    phrases_en: list[str] = Field(default_factory=list)
    keys: list[str]
    label_es: str | None = None
    label_en: str | None = None
    description_es: str | None = None
    description_en: str | None = None

    @field_validator("id")
    @classmethod
    def _id_format(cls, v: str) -> str:
        if not ID_RE.match(v):
            raise ValueError(f"id inválido '{v}': usar snake_case minúsculas/dígitos, 1-32 chars")
        return v

    @field_validator("keys")
    @classmethod
    def _keys_format(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("keys no puede estar vacío")
        for k in v:
            if not KEYCOMBO_RE.match(k.lower()):
                raise ValueError(f"combo inválido '{k}': usar p.ej. 'alt+n', 'l', 'ctrl+shift+x'")
        return [k.lower() for k in v]

    @model_validator(mode="after")
    def _at_least_one_phrase(self) -> Command:
        if not self.phrases_es and not self.phrases_en:
            raise ValueError(
                f"comando '{self.id}': al menos una de phrases_es/phrases_en debe tener entradas"
            )
        return self

    def label_for(self, lang: str) -> str:
        if lang == "en":
            return self.label_en or self.label_es or self.id
        return self.label_es or self.label_en or self.id

    def description_for(self, lang: str) -> str:
        if lang == "en":
            return self.description_en or self.description_es or ""
        return self.description_es or self.description_en or ""

    def phrases_for(self, lang: str) -> list[str]:
        return self.phrases_en if lang == "en" else self.phrases_es


class Profile(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, frozen=True)

    id: str
    label_es: str | None = None
    label_en: str | None = None
    description_es: str | None = None
    description_en: str | None = None
    commands: list[Command]

    @field_validator("id")
    @classmethod
    def _id_format(cls, v: str) -> str:
        if not ID_RE.match(v):
            raise ValueError(f"id de perfil inválido '{v}'")
        return v

    @model_validator(mode="after")
    def _unique_command_ids(self) -> Profile:
        seen = set()
        for c in self.commands:
            if c.id in seen:
                raise ValueError(f"perfil '{self.id}': command id duplicado '{c.id}'")
            seen.add(c.id)
        return self

    def label_for(self, lang: str) -> str:
        if lang == "en":
            return self.label_en or self.label_es or self.id
        return self.label_es or self.label_en or self.id


class CommandsFileV2(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    version: Literal[2] = 2
    settings: Settings = Field(default_factory=Settings)
    profiles: list[Profile]

    @model_validator(mode="after")
    def _validate_profiles(self) -> CommandsFileV2:
        if not self.profiles:
            raise ValueError("debe existir al menos un perfil")
        ids = [p.id for p in self.profiles]
        if len(ids) != len(set(ids)):
            raise ValueError(f"profile ids duplicados: {ids}")
        if self.settings.active_profile not in ids:
            raise ValueError(
                f"settings.active_profile='{self.settings.active_profile}' no existe en profiles"
            )
        return self

    # ---- API pública ----

    def get_profile(self, profile_id: str) -> Profile:
        for p in self.profiles:
            if p.id == profile_id:
                return p
        raise KeyError(profile_id)

    def with_settings(self, **changes: Any) -> CommandsFileV2:
        merged = {**self.settings.model_dump(), **changes}
        return self.model_copy(update={"settings": Settings(**merged)})

    def to_dump(self) -> dict[str, Any]:
        return self.model_dump(mode="json", exclude_none=False)


# ============================================================================
# Carga + migración
# ============================================================================


def load(path: Path) -> CommandsFileV2:
    """Carga commands.yaml. Migra v1→v2 si hace falta y deja backup."""
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        raise ConfigError(f"YAML inválido en {path}: {e}") from e
    if not isinstance(raw, dict):
        raise ConfigError(f"{path}: el root debe ser un mapping")
    version = raw.get("version", 1)
    if version == 1:
        migrated = _migrate_v1_to_v2(raw)
        _save_v1_backup(path, raw)
        return migrated
    if version == 2:
        try:
            return CommandsFileV2.model_validate(raw)
        except Exception as e:
            raise ConfigError(f"validación v2 falló en {path}: {e}") from e
    raise ConfigError(f"versión no soportada en {path}: {version}")


def _save_v1_backup(path: Path, raw_v1: dict[str, Any]) -> None:
    backup = path.with_name("commands.v1.backup.yaml")
    if not backup.exists():
        backup.write_text(
            yaml.safe_dump(raw_v1, sort_keys=False, allow_unicode=True), encoding="utf-8"
        )


def _migrate_v1_to_v2(raw: dict[str, Any]) -> CommandsFileV2:
    settings = dict(raw.get("settings", {}))
    # Renombrar `language` legacy → `active_language`.
    if "language" in settings and "active_language" not in settings:
        settings["active_language"] = settings.pop("language")
    settings.setdefault("active_profile", "default")
    settings.setdefault("ui_language", "es")
    settings.setdefault("profile_switch_hotkey", "ctrl+f12")

    commands_v2: list[dict[str, Any]] = []
    for c in raw.get("commands", []):
        cid = c["id"]
        commands_v2.append(
            {
                "id": cid,
                "phrases_es": list(c.get("phrases", [])),
                "phrases_en": [],
                "keys": list(c.get("keys", [])),
                "label_es": cid.replace("_", " ").title(),
                "label_en": cid.replace("_", " ").title(),
            }
        )

    return CommandsFileV2.model_validate(
        {
            "version": 2,
            "settings": settings,
            "profiles": [
                {
                    "id": "default",
                    "label_es": "Por defecto",
                    "label_en": "Default",
                    "description_es": "Perfil migrado desde commands.yaml v1.",
                    "description_en": "Profile migrated from commands.yaml v1.",
                    "commands": commands_v2,
                }
            ],
        }
    )


# ============================================================================
# Persistencia atómica
# ============================================================================


def save_atomic(cf: CommandsFileV2, path: Path) -> None:
    """Escribe a tmp y rename — evita corrupción si el proceso muere a mitad del write."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".commands-", suffix=".yaml", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            yaml.safe_dump(
                cf.to_dump(),
                f,
                sort_keys=False,
                allow_unicode=True,
                default_flow_style=False,
            )
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
