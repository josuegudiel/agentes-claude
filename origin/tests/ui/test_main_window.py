"""Smoke test del MainWindow."""
from __future__ import annotations

import pytest

pytest.importorskip("PySide6")


@pytest.mark.gui
def test_main_window_builds_and_navigates(qtbot, stub_orch):
    from origin.ui.engine_bridge import EngineBridge
    from origin.ui.i18n.tr import load as load_lang
    from origin.ui.main_window import MainWindow

    orch, bus = stub_orch
    load_lang("es")
    bridge = EngineBridge(bus)
    w = MainWindow(orch, bridge)
    qtbot.addWidget(w)
    assert w._sidebar.count() == 6
    w._sidebar.setCurrentRow(2)  # profiles
    assert w._stack.currentIndex() == 2
    w._sidebar.setCurrentRow(3)  # settings
    assert w._stack.currentIndex() == 3


@pytest.mark.gui
def test_main_window_toggle_language_emits_event(qtbot, stub_orch):
    from origin.engine.events import EventType
    from origin.ui.engine_bridge import EngineBridge
    from origin.ui.i18n.tr import load as load_lang
    from origin.ui.main_window import MainWindow

    orch, bus = stub_orch
    load_lang("es")
    bridge = EngineBridge(bus)
    w = MainWindow(orch, bridge)
    qtbot.addWidget(w)

    received: list[dict] = []
    bus.subscribe(EventType.LANGUAGE_CHANGED, lambda p: received.append(p))
    w._on_lang_clicked("en")
    assert any(p.get("lang") == "en" for p in received)
