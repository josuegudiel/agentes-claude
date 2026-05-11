"""Página Ajustes — todas las preferencias del bloque `settings` del commands.yaml."""
from __future__ import annotations

import logging
from typing import Any

from PySide6.QtCore import Qt
from PySide6.QtGui import QDesktopServices
from PySide6.QtCore import QUrl
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QScrollArea,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

from ...engine import audio as audiomod
from ...engine import autostart_windows
from ...engine import keypress
from ...engine.paths import default_paths
from ...engine.runtime import Orchestrator
from ..engine_bridge import EngineBridge
from ..i18n.tr import register_retranslatable, tr
from ..widgets.fuzz_slider import FuzzSlider
from ..widgets.key_capture import KeyCapture

logger = logging.getLogger(__name__)


WHISPER_MODELS = ["tiny", "base", "small", "medium", "large-v3"]
MODEL_SIZE_HINT = {"tiny": "~75 MB", "base": "~145 MB", "small": "~485 MB", "medium": "~1.5 GB", "large-v3": "~3 GB"}
DEVICES = ["auto", "cpu", "cuda"]
COMPUTE_TYPES = ["auto", "int8", "int8_float16", "float16", "float32"]
SAMPLE_RATES = [16000, 44100, 48000]
LOG_FORMATS = ["pretty", "json"]
UI_LANGS = ["es", "en"]
THEMES = ["system", "light", "dark"]


def _cuda_available() -> bool:
    try:
        import ctranslate2  # type: ignore[import-untyped]

        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


class SettingsPage(QWidget):
    def __init__(self, orch: Orchestrator, bridge: EngineBridge, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._orch = orch
        self._bridge = bridge
        self._build_ui()
        self._populate_from_settings()
        register_retranslatable(self.retranslate)

    def _build_ui(self) -> None:
        outer = QVBoxLayout(self)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        outer.addWidget(scroll, 1)
        page = QWidget()
        scroll.setWidget(page)
        root = QVBoxLayout(page)

        # ----- Hotkeys -----
        self._gb_hotkeys = QGroupBox()
        f = QFormLayout(self._gb_hotkeys)
        self._ptt = KeyCapture(initial=self._orch.config.settings.ptt_key, capture_combo=False, validate_cb=keypress.validate)
        self._ptt.keyCaptured.connect(lambda v: self._apply("ptt_key", v))
        self._lbl_ptt = QLabel()
        f.addRow(self._lbl_ptt, self._ptt)
        self._switch = KeyCapture(
            initial=self._orch.config.settings.profile_switch_hotkey,
            capture_combo=True,
            validate_cb=keypress.validate,
        )
        self._switch.keyCaptured.connect(lambda v: self._apply("profile_switch_hotkey", v))
        self._lbl_switch = QLabel()
        f.addRow(self._lbl_switch, self._switch)
        root.addWidget(self._gb_hotkeys)

        # ----- Whisper -----
        self._gb_whisper = QGroupBox()
        f = QFormLayout(self._gb_whisper)
        self._cb_model = QComboBox()
        for m in WHISPER_MODELS:
            self._cb_model.addItem(f"{m}  ({MODEL_SIZE_HINT[m]})", m)
        self._cb_model.currentIndexChanged.connect(
            lambda _i: self._apply("whisper_model", self._cb_model.currentData())
        )
        self._lbl_model = QLabel()
        f.addRow(self._lbl_model, self._cb_model)

        self._cb_device = QComboBox()
        for d in DEVICES:
            self._cb_device.addItem(d, d)
        if not _cuda_available():
            idx = self._cb_device.findData("cuda")
            if idx >= 0:
                item = self._cb_device.model().item(idx)
                if item:
                    item.setEnabled(False)
        self._cb_device.currentIndexChanged.connect(
            lambda _i: self._apply("whisper_device", self._cb_device.currentData())
        )
        self._lbl_device = QLabel()
        f.addRow(self._lbl_device, self._cb_device)

        self._cb_compute = QComboBox()
        for c in COMPUTE_TYPES:
            self._cb_compute.addItem(c, c)
        self._cb_compute.currentIndexChanged.connect(
            lambda _i: self._apply("whisper_compute_type", self._cb_compute.currentData())
        )
        self._lbl_compute = QLabel()
        f.addRow(self._lbl_compute, self._cb_compute)

        root.addWidget(self._gb_whisper)

        # ----- Audio -----
        self._gb_audio = QGroupBox()
        f = QFormLayout(self._gb_audio)
        mic_row = QHBoxLayout()
        self._cb_mic = QComboBox()
        self._refresh_mics()
        self._cb_mic.currentIndexChanged.connect(
            lambda _i: self._apply("mic_device", self._cb_mic.currentData())
        )
        self._btn_refresh_mics = QPushButton()
        self._btn_refresh_mics.clicked.connect(self._refresh_mics)
        mic_row.addWidget(self._cb_mic, 1)
        mic_row.addWidget(self._btn_refresh_mics)
        self._lbl_mic = QLabel()
        f.addRow(self._lbl_mic, mic_row)

        self._cb_sr = QComboBox()
        for sr in SAMPLE_RATES:
            self._cb_sr.addItem(str(sr), sr)
        self._cb_sr.currentIndexChanged.connect(
            lambda _i: self._apply("sample_rate", self._cb_sr.currentData())
        )
        self._lbl_sr = QLabel()
        f.addRow(self._lbl_sr, self._cb_sr)

        self._sp_maxrec = QSpinBox()
        self._sp_maxrec.setRange(1, 60)
        self._sp_maxrec.valueChanged.connect(lambda v: self._apply("max_record_seconds", int(v)))
        self._lbl_maxrec = QLabel()
        f.addRow(self._lbl_maxrec, self._sp_maxrec)

        root.addWidget(self._gb_audio)

        # ----- Matching -----
        self._gb_match = QGroupBox()
        f = QFormLayout(self._gb_match)
        self._fuzz = FuzzSlider(initial=self._orch.config.settings.fuzz_threshold, preview_cb=self._preview_match)
        self._fuzz.valueChanged.connect(lambda v: self._apply("fuzz_threshold", int(v)))
        self._lbl_fuzz = QLabel()
        f.addRow(self._lbl_fuzz, self._fuzz)
        self._sp_delay = QSpinBox()
        self._sp_delay.setRange(0, 500)
        self._sp_delay.valueChanged.connect(lambda v: self._apply("inter_key_delay_ms", int(v)))
        self._lbl_delay = QLabel()
        f.addRow(self._lbl_delay, self._sp_delay)
        root.addWidget(self._gb_match)

        # ----- UI -----
        self._gb_ui = QGroupBox()
        f = QFormLayout(self._gb_ui)
        self._cb_ui_lang = QComboBox()
        for lang in UI_LANGS:
            self._cb_ui_lang.addItem(lang.upper(), lang)
        self._cb_ui_lang.currentIndexChanged.connect(
            lambda _i: self._apply("ui_language", self._cb_ui_lang.currentData())
        )
        self._lbl_ui_lang = QLabel()
        f.addRow(self._lbl_ui_lang, self._cb_ui_lang)
        self._cb_theme = QComboBox()
        for t in THEMES:
            self._cb_theme.addItem(t, t)
        self._cb_theme.currentIndexChanged.connect(
            lambda _i: self._apply("theme", self._cb_theme.currentData())
        )
        self._lbl_theme = QLabel()
        f.addRow(self._lbl_theme, self._cb_theme)
        root.addWidget(self._gb_ui)

        # ----- Startup -----
        self._gb_startup = QGroupBox()
        f = QFormLayout(self._gb_startup)
        self._chk_autostart = QCheckBox()
        self._chk_autostart.toggled.connect(self._on_autostart_toggled)
        self._chk_minimized = QCheckBox()
        self._chk_minimized.toggled.connect(lambda v: self._apply("start_minimized", bool(v)))
        if not autostart_windows.is_supported():
            self._chk_autostart.setEnabled(False)
            self._chk_autostart.setToolTip(tr("settings.autostart_not_supported"))
        self._lbl_autostart = QLabel()
        self._lbl_minimized = QLabel()
        f.addRow(self._lbl_autostart, self._chk_autostart)
        f.addRow(self._lbl_minimized, self._chk_minimized)
        root.addWidget(self._gb_startup)

        # ----- Logs -----
        self._gb_logs = QGroupBox()
        f = QFormLayout(self._gb_logs)
        self._cb_log = QComboBox()
        for lf in LOG_FORMATS:
            self._cb_log.addItem(lf, lf)
        self._cb_log.currentIndexChanged.connect(
            lambda _i: self._apply("log_format", self._cb_log.currentData())
        )
        self._lbl_log = QLabel()
        f.addRow(self._lbl_log, self._cb_log)
        self._btn_open_logs = QPushButton()
        self._btn_open_logs.clicked.connect(self._open_logs_folder)
        f.addRow("", self._btn_open_logs)
        root.addWidget(self._gb_logs)

        root.addStretch(1)
        self.retranslate()

    # ---------------------------------------------------------------- populate

    def _populate_from_settings(self) -> None:
        s = self._orch.config.settings
        # Bloqueamos signals para no disparar apply en cascada al setear UI.
        for w in (self._cb_model, self._cb_device, self._cb_compute, self._cb_mic, self._cb_sr,
                  self._cb_ui_lang, self._cb_theme, self._cb_log, self._sp_maxrec, self._sp_delay,
                  self._chk_autostart, self._chk_minimized):
            w.blockSignals(True)
        try:
            self._cb_model.setCurrentIndex(self._cb_model.findData(s.whisper_model))
            self._cb_device.setCurrentIndex(self._cb_device.findData(s.whisper_device))
            self._cb_compute.setCurrentIndex(self._cb_compute.findData(s.whisper_compute_type))
            idx = self._cb_mic.findData(s.mic_device)
            if idx >= 0:
                self._cb_mic.setCurrentIndex(idx)
            self._cb_sr.setCurrentIndex(self._cb_sr.findData(s.sample_rate))
            self._sp_maxrec.setValue(s.max_record_seconds)
            self._fuzz._slider.setValue(s.fuzz_threshold)  # noqa: SLF001
            self._sp_delay.setValue(s.inter_key_delay_ms)
            self._cb_ui_lang.setCurrentIndex(self._cb_ui_lang.findData(s.ui_language))
            self._cb_theme.setCurrentIndex(self._cb_theme.findData(s.theme))
            self._cb_log.setCurrentIndex(self._cb_log.findData(s.log_format))
            self._chk_autostart.setChecked(s.autostart_windows)
            self._chk_minimized.setChecked(s.start_minimized)
        finally:
            for w in (self._cb_model, self._cb_device, self._cb_compute, self._cb_mic, self._cb_sr,
                      self._cb_ui_lang, self._cb_theme, self._cb_log, self._sp_maxrec, self._sp_delay,
                      self._chk_autostart, self._chk_minimized):
                w.blockSignals(False)

    def _refresh_mics(self) -> None:
        s = self._orch.config.settings
        self._cb_mic.blockSignals(True)
        self._cb_mic.clear()
        self._cb_mic.addItem("(default)", None)
        try:
            for d in audiomod.list_input_devices():
                tag = " *" if d.get("default") else ""
                self._cb_mic.addItem(f"{d['index']}: {d['name']}{tag}", d["index"])
        except Exception:
            logger.exception("list_mics_failed")
        idx = self._cb_mic.findData(s.mic_device)
        if idx >= 0:
            self._cb_mic.setCurrentIndex(idx)
        self._cb_mic.blockSignals(False)

    def _preview_match(self, text: str) -> list[tuple[str, float]]:
        matcher = self._orch.profiles.matcher()
        results = matcher.preview(text, self._orch.config.settings.active_language, top_n=8)
        return [(f"{cmd.id}  ←  {phrase}", score) for cmd, phrase, score in results]

    # ---------------------------------------------------------------- apply

    def _apply(self, key: str, value: Any) -> None:
        try:
            self._orch.set_setting(**{key: value})
        except Exception as e:
            logger.exception("set_setting_failed key=%s", key)
            from PySide6.QtWidgets import QMessageBox

            QMessageBox.warning(self, tr("common.error"), str(e))

    def _on_autostart_toggled(self, checked: bool) -> None:
        if checked:
            autostart_windows.write_run_key()
        else:
            autostart_windows.remove_run_key()
        self._apply("autostart_windows", bool(checked))

    def _open_logs_folder(self) -> None:
        paths = default_paths()
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(paths.logs_dir)))

    # ---------------------------------------------------------------- i18n

    def retranslate(self) -> None:
        self._gb_hotkeys.setTitle(tr("settings.section.hotkeys"))
        self._gb_whisper.setTitle(tr("settings.section.whisper"))
        self._gb_audio.setTitle(tr("settings.section.audio"))
        self._gb_match.setTitle(tr("settings.section.matching"))
        self._gb_ui.setTitle(tr("settings.section.ui"))
        self._gb_startup.setTitle(tr("settings.section.startup"))
        self._gb_logs.setTitle(tr("settings.section.logs"))
        self._lbl_ptt.setText(tr("settings.ptt_key"))
        self._lbl_switch.setText(tr("settings.profile_switch_hotkey"))
        self._lbl_model.setText(tr("settings.whisper_model"))
        self._lbl_device.setText(tr("settings.whisper_device"))
        self._lbl_compute.setText(tr("settings.whisper_compute_type"))
        self._lbl_mic.setText(tr("settings.mic_device"))
        self._btn_refresh_mics.setText(tr("settings.mic_refresh"))
        self._lbl_sr.setText(tr("settings.sample_rate"))
        self._lbl_maxrec.setText(tr("settings.max_record_seconds"))
        self._lbl_fuzz.setText(tr("settings.fuzz_threshold"))
        self._lbl_delay.setText(tr("settings.inter_key_delay_ms"))
        self._lbl_ui_lang.setText(tr("settings.ui_language"))
        self._lbl_theme.setText(tr("settings.theme"))
        self._lbl_autostart.setText(tr("settings.autostart_windows"))
        self._lbl_minimized.setText(tr("settings.start_minimized"))
        self._lbl_log.setText(tr("settings.log_format"))
        self._btn_open_logs.setText(tr("settings.open_logs_folder"))
        self._fuzz.setPlaceholder(tr("settings.preview_placeholder"))
