"""Orquestador: PTT listener + Recorder + Transcriber + IntentMatcher + Keypress.

Estado: IDLE → RECORDING → TRANSCRIBING → EXECUTING → IDLE.
Las transiciones están protegidas por `_state_lock` y publican `ENGINE_STATE_CHANGED`.

Si un PTT-press llega durante TRANSCRIBING/EXECUTING → se ignora con log `ptt_busy`.
Si el PTT-press es un auto-repeat del SO mientras ya estamos RECORDING → se ignora.
El perfil se snapshotea al PTT-press; un switch durante captura aplica al siguiente PTT.
"""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from enum import Enum
from pathlib import Path
from typing import Any

from . import config as cfgmod
from . import keypress
from .audio import Recorder
from .events import EventBus, EventType
from .profiles import ProfileRegistry
from .stt import Transcriber

logger = logging.getLogger(__name__)


class State(str, Enum):
    LOADING = "loading_model"
    READY = "ready"
    PAUSED = "paused"
    RECORDING = "recording"
    TRANSCRIBING = "transcribing"
    EXECUTING = "executing"
    ERROR = "error"


_MIN_RECORD_SECONDS = 0.3  # tap accidental → descartar


class Orchestrator:
    def __init__(
        self,
        config_path: Path,
        bus: EventBus,
        dry_run: bool = False,
    ) -> None:
        self._config_path = config_path
        self._bus = bus
        self._dry_run = dry_run

        cf = cfgmod.load(config_path)
        self._cf = cf
        self._profiles = ProfileRegistry(cf)
        self._settings = cf.settings

        self._recorder: Recorder | None = None
        self._transcriber: Transcriber | None = None
        self._executor: ThreadPoolExecutor | None = None
        self._kb_listener: Any | None = None  # pynput.keyboard.Listener
        self._hk_listener: Any | None = None  # pynput.keyboard.GlobalHotKeys
        self._watchdog_obs: Any | None = None

        self._state = State.LOADING
        self._state_lock = threading.RLock()
        self._ptt_pressed = False
        self._capture_started_at: float | None = None
        self._capture_profile_id: str | None = None
        self._record_start_emitted = False

    # ====================================================================
    # Ciclo de vida
    # ====================================================================

    def start(self, autoload_model: bool = True) -> None:
        logger.info("orchestrator_start dry_run=%s", self._dry_run)
        self._executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="origin-stt"
        )
        self._recorder = Recorder(
            sample_rate=self._settings.sample_rate,
            mic_device=self._settings.mic_device,
            max_record_seconds=self._settings.max_record_seconds,
            on_level=self._emit_audio_level,
        )
        self._recorder.start_stream()
        self._transcriber = Transcriber(
            model_name=self._settings.whisper_model,
            device_preference=self._settings.whisper_device,
            compute_type=self._settings.whisper_compute_type,
        )
        if autoload_model:
            self._executor.submit(self._load_model)
        self._start_keyboard_listeners()
        self._start_watchdog()

    def shutdown(self) -> None:
        logger.info("orchestrator_shutdown")
        self._stop_watchdog()
        self._stop_keyboard_listeners()
        if self._recorder:
            self._recorder.stop_stream()
        if self._executor:
            self._executor.shutdown(wait=True, cancel_futures=False)

    # ====================================================================
    # Control desde la UI
    # ====================================================================

    def pause(self) -> None:
        with self._state_lock:
            if self._state == State.PAUSED:
                return
            self._set_state(State.PAUSED)

    def resume(self) -> None:
        with self._state_lock:
            if self._state != State.PAUSED:
                return
            self._set_state(State.READY)

    def is_paused(self) -> bool:
        with self._state_lock:
            return self._state == State.PAUSED

    @property
    def state(self) -> State:
        with self._state_lock:
            return self._state

    @property
    def config(self) -> cfgmod.CommandsFileV2:
        return self._cf

    @property
    def config_path(self) -> Path:
        return self._config_path

    @property
    def profiles(self) -> ProfileRegistry:
        return self._profiles

    def set_active_profile(self, profile_id: str) -> bool:
        ok = self._profiles.set_active(profile_id)
        if ok:
            self._bus.emit(EventType.PROFILE_CHANGED, {"profile_id": profile_id})
        return ok

    def cycle_profile(self) -> str:
        new_id = self._profiles.cycle_next()
        self._bus.emit(EventType.PROFILE_CHANGED, {"profile_id": new_id})
        return new_id

    def set_active_language(self, lang: str) -> None:
        if lang not in ("es", "en"):
            raise ValueError(f"idioma inválido: {lang}")
        # El settings es inmutable; reemplazamos en memoria.
        self._cf = self._cf.with_settings(active_language=lang)
        self._settings = self._cf.settings
        self._bus.emit(EventType.LANGUAGE_CHANGED, {"lang": lang})

    def set_setting(self, **changes: Any) -> None:
        """Aplica cambios al bloque settings, emite eventos y persiste.

        Cambios costosos (whisper_model/device/compute_type, mic_device, ptt_key,
        profile_switch_hotkey) se reconcilian con un rebuild parcial.
        """
        old = self._settings
        self._cf = self._cf.with_settings(**changes)
        self._settings = self._cf.settings
        cfgmod.save_atomic(self._cf, self._config_path)

        if "mic_device" in changes and self._recorder:
            self._recorder.restart_stream(self._settings.mic_device)
        if any(k in changes for k in ("whisper_model", "whisper_device", "whisper_compute_type")):
            self._rebuild_transcriber()
        if "ptt_key" in changes or "profile_switch_hotkey" in changes:
            self._stop_keyboard_listeners()
            self._start_keyboard_listeners()
        if "active_language" in changes and old.active_language != self._settings.active_language:
            self._bus.emit(EventType.LANGUAGE_CHANGED, {"lang": self._settings.active_language})
        if "active_profile" in changes and old.active_profile != self._settings.active_profile:
            self.set_active_profile(self._settings.active_profile)

    def reload_config(self) -> bool:
        """Recarga desde disco. Emite CONFIG_RELOADED o CONFIG_ERROR.
        Devuelve True si OK."""
        try:
            new_cf = cfgmod.load(self._config_path)
        except cfgmod.ConfigError as e:
            logger.error("config_reload_failed: %s", e)
            self._bus.emit(EventType.CONFIG_ERROR, {"error": str(e)})
            return False
        with self._state_lock:
            self._cf = new_cf
            self._settings = new_cf.settings
            self._profiles.replace_config(new_cf)
        self._bus.emit(EventType.CONFIG_RELOADED, {})
        return True

    def execute_command_test(self, command_id: str, profile_id: str | None = None) -> None:
        """Ejecuta las teclas de un comando sin necesidad de hablar. Usado por
        el botón 'Test command' del editor."""
        pid = profile_id or self._profiles.active_id
        prof = self._cf.get_profile(pid)
        cmd = next((c for c in prof.commands if c.id == command_id), None)
        if cmd is None:
            raise KeyError(command_id)
        self._set_state(State.EXECUTING)
        try:
            keypress.execute(cmd.keys, self._settings.inter_key_delay_ms, dry_run=self._dry_run)
            self._bus.emit(
                EventType.COMMAND_EXECUTED,
                {"command_id": cmd.id, "keys": list(cmd.keys), "dry_run": self._dry_run, "test": True},
            )
        finally:
            self._set_state(State.READY if not self.is_paused() else State.PAUSED)

    # ====================================================================
    # Internos
    # ====================================================================

    def _set_state(self, new_state: State) -> None:
        with self._state_lock:
            if self._state == new_state:
                return
            self._state = new_state
        self._bus.emit(EventType.ENGINE_STATE_CHANGED, {"state": new_state.value})

    def _emit_audio_level(self, rms: float) -> None:
        # Normalización rudimentaria — la UI sabe que <0.7 es ok, >0.9 clipping.
        self._bus.emit(EventType.AUDIO_LEVEL, {"rms": rms})

    def _load_model(self) -> None:
        assert self._transcriber is not None
        try:
            self._transcriber.load()
        except Exception as e:
            logger.exception("model_load_failed")
            self._bus.emit(EventType.CONFIG_ERROR, {"error": f"Whisper load failed: {e}"})
            self._set_state(State.ERROR)
            return
        self._set_state(State.READY)

    def _rebuild_transcriber(self) -> None:
        assert self._executor is not None
        self._set_state(State.LOADING)
        self._transcriber = Transcriber(
            model_name=self._settings.whisper_model,
            device_preference=self._settings.whisper_device,
            compute_type=self._settings.whisper_compute_type,
        )
        self._executor.submit(self._load_model)

    # ----- Keyboard hooks -----

    def _start_keyboard_listeners(self) -> None:
        from pynput import keyboard as kb  # lazy

        # PTT — un único key, manejado con press/release.
        ptt_key = self._parse_pynput_key(self._settings.ptt_key)

        def on_press(key: Any) -> None:
            if self._matches(key, ptt_key):
                self._on_ptt_press()

        def on_release(key: Any) -> None:
            if self._matches(key, ptt_key):
                self._on_ptt_release()

        self._kb_listener = kb.Listener(on_press=on_press, on_release=on_release)
        self._kb_listener.start()

        # Profile-switch hotkey (combo con modificadores) — GlobalHotKeys lo maneja solo.
        try:
            hk_spec = self._format_hotkey_for_pynput(self._settings.profile_switch_hotkey)
            self._hk_listener = kb.GlobalHotKeys({hk_spec: self._on_cycle_hotkey})
            self._hk_listener.start()
        except Exception:
            logger.exception(
                "profile_switch_hotkey_failed hotkey=%s",
                self._settings.profile_switch_hotkey,
            )

    def _stop_keyboard_listeners(self) -> None:
        for listener in (self._kb_listener, self._hk_listener):
            if listener is not None:
                try:
                    listener.stop()
                except Exception:
                    logger.exception("keyboard_listener_stop_failed")
        self._kb_listener = None
        self._hk_listener = None

    @staticmethod
    def _parse_pynput_key(name: str) -> Any:
        from pynput import keyboard as kb

        n = name.lower().strip()
        # alias
        n = {"esc": "escape", "return": "enter"}.get(n, n)
        if hasattr(kb.Key, n):
            return getattr(kb.Key, n)
        if len(n) == 1:
            return kb.KeyCode.from_char(n)
        raise ValueError(f"PTT key '{name}' no soportada por pynput")

    @staticmethod
    def _format_hotkey_for_pynput(combo: str) -> str:
        """`"ctrl+f12"` → `"<ctrl>+<f12>"` (formato GlobalHotKeys)."""
        parts = []
        for p in combo.lower().split("+"):
            p = p.strip()
            if not p:
                continue
            if len(p) == 1 and p.isalnum():
                parts.append(p)
            else:
                parts.append(f"<{p}>")
        return "+".join(parts)

    @staticmethod
    def _matches(received: Any, expected: Any) -> bool:
        try:
            return received == expected
        except Exception:
            return False

    # ----- PTT flow -----

    def _on_ptt_press(self) -> None:
        with self._state_lock:
            if self._state in (State.PAUSED, State.LOADING, State.ERROR):
                logger.debug("ptt_press_ignored state=%s", self._state.value)
                return
            if self._state in (State.TRANSCRIBING, State.EXECUTING):
                logger.info("ptt_busy state=%s", self._state.value)
                return
            if self._ptt_pressed:
                # Auto-repeat del SO mientras la tecla sigue down — no reiniciar.
                return
            self._ptt_pressed = True
            self._capture_started_at = time.monotonic()
            self._capture_profile_id = self._profiles.active_id
            assert self._recorder is not None
            self._recorder.begin_capture()
            self._set_state(State.RECORDING)

    def _on_ptt_release(self) -> None:
        with self._state_lock:
            if not self._ptt_pressed:
                return
            self._ptt_pressed = False
            if self._state != State.RECORDING:
                return
            assert self._recorder is not None
            audio = self._recorder.end_capture()
            elapsed = (
                time.monotonic() - self._capture_started_at
                if self._capture_started_at else 0.0
            )
            if elapsed < _MIN_RECORD_SECONDS or audio.size == 0:
                logger.info("ptt_too_short elapsed=%.2fs", elapsed)
                self._set_state(State.READY)
                return
            self._set_state(State.TRANSCRIBING)
        # Fuera del lock para no bloquear el listener si el executor se llena.
        assert self._executor is not None
        profile_id = self._capture_profile_id or self._profiles.active_id
        fut = self._executor.submit(self._process_audio, audio, profile_id)
        fut.add_done_callback(self._on_process_done)

    def _process_audio(self, audio: Any, profile_id: str) -> dict[str, Any]:
        t0 = time.monotonic()
        lang = self._settings.active_language
        text = ""
        try:
            assert self._transcriber is not None
            text = self._transcriber.transcribe(audio, lang)
        except Exception as e:
            logger.exception("transcription_failed")
            return {"error": str(e)}
        stt_ms = int((time.monotonic() - t0) * 1000)
        self._bus.emit(
            EventType.TRANSCRIPTION_DONE,
            {"text": text, "language": lang, "elapsed_ms": stt_ms},
        )
        # Match contra el perfil snapshoteado al PTT-press.
        try:
            prof = self._cf.get_profile(profile_id)
        except KeyError:
            prof = self._profiles.active()
        from .intent import IntentMatcher

        matcher = (
            self._profiles.matcher() if prof.id == self._profiles.active_id else IntentMatcher(prof.commands)
        )
        t1 = time.monotonic()
        result = matcher.match(text, lang, self._settings.fuzz_threshold)
        match_ms = int((time.monotonic() - t1) * 1000)
        self._bus.emit(
            EventType.MATCH_DONE,
            {
                "text": text,
                "command_id": result.command.id if result.command else None,
                "score": float(result.score),
                "phrase": result.phrase,
                "keys": list(result.command.keys) if result.command else None,
                "elapsed_ms": match_ms,
            },
        )
        if result.command is not None:
            self._set_state(State.EXECUTING)
            keypress.execute(
                result.command.keys,
                self._settings.inter_key_delay_ms,
                dry_run=self._dry_run,
            )
            self._bus.emit(
                EventType.COMMAND_EXECUTED,
                {
                    "command_id": result.command.id,
                    "keys": list(result.command.keys),
                    "dry_run": self._dry_run,
                    "test": False,
                },
            )
        return {"ok": True}

    def _on_process_done(self, fut: Future[dict[str, Any]]) -> None:
        try:
            fut.result()
        except Exception:
            logger.exception("process_audio_failed")
        finally:
            with self._state_lock:
                if self._state not in (State.PAUSED, State.ERROR):
                    self._set_state(State.READY)

    def _on_cycle_hotkey(self) -> None:
        try:
            self.cycle_profile()
        except Exception:
            logger.exception("cycle_profile_failed")

    # ----- Watchdog (hot-reload del commands.yaml) -----

    def _start_watchdog(self) -> None:
        try:
            from watchdog.events import FileSystemEventHandler  # type: ignore[import-untyped]
            from watchdog.observers import Observer  # type: ignore[import-untyped]
        except ImportError:
            logger.info("watchdog_unavailable hot_reload_disabled")
            return

        debounce_seconds = 0.3
        last_fired = [0.0]
        target = str(self._config_path.resolve())
        path_dir = str(self._config_path.parent.resolve())

        outer = self

        class Handler(FileSystemEventHandler):
            def on_modified(self, event: Any) -> None:
                if event.is_directory:
                    return
                try:
                    if Path(event.src_path).resolve().as_posix() != Path(target).as_posix():
                        return
                except Exception:
                    return
                now = time.monotonic()
                if now - last_fired[0] < debounce_seconds:
                    return
                last_fired[0] = now
                threading.Timer(debounce_seconds, outer.reload_config).start()

        obs = Observer()
        obs.schedule(Handler(), path_dir, recursive=False)
        obs.daemon = True
        obs.start()
        self._watchdog_obs = obs

    def _stop_watchdog(self) -> None:
        if self._watchdog_obs is None:
            return
        try:
            self._watchdog_obs.stop()
            self._watchdog_obs.join(timeout=2)
        except Exception:
            logger.exception("watchdog_stop_failed")
        finally:
            self._watchdog_obs = None
