# Origin v0.3 — Architecture

## 1. Overview

Origin es un asistente de voz bilingüe (ES/EN) push-to-talk para Star Citizen 4.x. Captura audio mientras se mantiene una tecla (default `F12`) o un botón de HOTAS, transcribe con `faster-whisper` (modelo `small` por default, bundled en el instalador), matchea la transcripción contra el catálogo de frases del perfil activo con `rapidfuzz.token_set_ratio`, y si el score supera `fuzz_threshold` ejecuta los `keys` o `steps` del comando vía `pydirectinput` (DirectInput, no SendInput — Star Citizen ignora SendInput). El motor opcionalmente sintetiza un acknowledge con Piper TTS local, y si ningún comando matchea pero la transcripción no está vacía puede pedirle a un LLM local (Ollama) que resuelva la intención contra el catálogo del perfil.

Decisiones top-level: (a) **engine sin Qt** — `origin/engine/*` no importa PySide6, lo que hace los tests headless en Linux/CI y desacopla la lógica del runtime de la GUI; el puente es un `EventBus` propio (`engine/events.py`) que la UI envuelve en `EngineBridge` (Qt signals con `QueuedConnection`). (b) **PTT siempre, nunca hot-word**: cero falsos positivos, latencia predecible. (c) **Bilingüe con toggle en runtime** — el idioma activo `es|en` lo elige el usuario antes de hablar (botones del header), filtra phrases del matcher y selecciona voz de TTS. (d) **Perfiles** intercambiables (flight, on-foot, mining...) con hotkey global `Ctrl+F12` para ciclar sin abrir la UI. (e) **DSL de scripting** opcional por comando (`steps:`), con `key`/`wait`/`say`/`say_key`/`set`/`if`/`goto`/`label`/`repeat`. (f) **LLM fallback** entre `floor_score` y `fuzz_threshold` — único path que cuesta latencia variable. (g) Distribución como **instalador Windows onedir** (PyInstaller + Inno Setup) con Piper, voces y modelo Whisper pre-empaquetados.

## 2. Capas y threading

```
                          +------------------------------------+
                          |   Main / Qt event loop (UI thread) |
                          |   - MainWindow, pages, widgets     |
                          |   - EngineBridge (QObject)         |
                          +------------------+-----------------+
                                             | Qt signals (QueuedConnection
                                             | porque emitidas desde otros threads)
                                             v
   +-----------------------------------------+-----------------------------------------+
   |                              EventBus  (engine/events.py)                          |
   |   subscribe / emit, fan-out síncrono en el thread del emisor                       |
   +-----------------------------------------+-----------------------------------------+
       ^         ^         ^         ^        ^                ^             ^
       |         |         |         |        |                |             |
   +---+--+  +---+---+ +---+---+ +---+----+ +-+------+   +-----+------+ +----+----+
   | kb   |  | hotkey| | sound | | hotas  | | piper  |   | watchdog   | | STT     |
   | ptt  |  | global| | dev cb| | device | | stdout | | observer    | | worker  |
   | hook |  | hotkey| |       | | loop   | | reader |   |            | | thread  |
   |daemon|  |daemon | |       | | (1×gp) | | (main) |   | daemon     | | (1×)    |
   +------+  +-------+ +-------+ +--------+ +--------+   +------------+ +---------+
     pynput   pynput   PortAudio  inputs    subprocess     watchdog       Future
     Listener Global   InputStream                                        callback
              HotKeys                                                     -> bus
```

Reglas de oro:
- Cualquier hilo del engine puede llamar `bus.emit()`. Cada subscriber corre en ese hilo emisor; los subscribers Qt re-emiten signals que llegan al main thread vía auto-connection (`QueuedConnection`).
- El `Orchestrator` protege transiciones de estado y mutaciones de `_script_states` con `self._state_lock` (`RLock`).
- El recorder mantiene el `sounddevice.InputStream` siempre abierto; `begin_capture()` y `end_capture()` arman/cierran ventanas. El callback de PortAudio es real-time, así que solo hace `np.copy` + push al buffer y calcula RMS para el VU meter.

## 3. State machine del orchestrator

Enum `State` definido en `origin/engine/runtime.py:36`. Visible para la UI vía `EventType.ENGINE_STATE_CHANGED`.

| Estado              | Significado                                                                 |
|---------------------|----------------------------------------------------------------------------|
| `LOADING`           | Cargando modelo Whisper (warm-up con 1s de silencio sintético).            |
| `READY`             | Esperando PTT.                                                              |
| `PAUSED`            | Usuario pausó (header / tray). Ignora todo PTT.                             |
| `RECORDING`         | PTT down; sounddevice está acumulando audio en buffer.                      |
| `TRANSCRIBING`      | `faster-whisper` corriendo en el worker `origin-stt`.                       |
| `EXECUTING`         | Legado v0.2 (`execute_command_test` antiguo). v0.3 lo cubre `RUNNING_SCRIPT`. |
| `RUNNING_SCRIPT`    | `StepExecutor.execute()` está iterando los steps del comando matcheado.     |
| `SPEAKING`          | Subproceso `piper.exe` activo y `sounddevice.RawOutputStream` reproduciendo.|
| `RESOLVING_INTENT`  | LLM fallback en vuelo (`OllamaClient.chat_json`).                           |
| `ERROR`             | Whisper falló al cargar. Banner rojo en la UI; PTT ignorado.                |

`_BUSY_STATES = {TRANSCRIBING, EXECUTING, RUNNING_SCRIPT, RESOLVING_INTENT}` (`runtime.py:50`). PTT en estos estados emite `ptt_busy` en logs y retorna. `SPEAKING` no es busy: si `settings.tts.cancel_on_ptt` está en `True` (default), el PTT corta el TTS con `PiperTTS.cancel()` y entra a `RECORDING`. `PAUSED`/`LOADING`/`ERROR` también ignoran PTT.

Transiciones legales (origen → destino):

| De \ A              | LOADING | READY | PAUSED | RECORDING | TRANSCRIBING | RUNNING_SCRIPT | SPEAKING | RESOLVING_INTENT | ERROR |
|---------------------|:-------:|:-----:|:------:|:---------:|:------------:|:--------------:|:--------:|:----------------:|:-----:|
| LOADING             |         |   *   |        |           |              |                |          |                  |   *   |
| READY               |    *    |       |   *    |     *     |              |                |          |                  |       |
| PAUSED              |         |   *   |        |           |              |                |          |                  |       |
| RECORDING           |         |   *   |        |           |       *      |                |          |                  |       |
| TRANSCRIBING        |         |   *   |        |           |              |       *        |          |        *         |       |
| RUNNING_SCRIPT      |         |   *   |        |           |              |                |    *     |                  |       |
| SPEAKING            |         |   *   |        |     *     |              |       *        |          |                  |       |
| RESOLVING_INTENT    |         |   *   |        |           |              |       *        |          |                  |       |
| ERROR               |         |       |        |           |              |                |          |                  |       |

`_set_state` es no-op si el nuevo estado coincide con el actual; solo emite `ENGINE_STATE_CHANGED` en cambios reales (`runtime.py:335`).

## 4. Threading model detallado

| Thread | Qué hace | Quién lo crea | Cuándo termina |
|---|---|---|---|
| Main / UI | Qt event loop (`app.exec()`). Pinta widgets, recibe signals queued. | `run_app` en `ui/app.py` | `app.quit()` desde tray. |
| `origin-stt` worker | `ThreadPoolExecutor(max_workers=1)`. Ejecuta `_load_model`, `_process_audio` y `_dispatch_command`. Single-worker para serializar contra el modelo de Whisper (no thread-safe entre `transcribe()` concurrentes — `stt.py:46`). | `Orchestrator.start()` (`runtime.py:113`) | `Orchestrator.shutdown()` con `cancel_futures=True`. |
| `pynput.keyboard.Listener` daemon | Hook global low-level del PTT key. Llama `_on_ptt_press`/`_on_ptt_release` en su propio thread daemon. | `_start_keyboard_listeners` (`runtime.py:368`) | `listener.stop()` o muerte del proceso. |
| `pynput.keyboard.GlobalHotKeys` daemon | Hook global del hotkey de ciclo de perfil (default `ctrl+f12`). Llama `cycle_profile`. | mismo método | igual. |
| PortAudio callback | Thread interno de `sounddevice`. Por cada bloque de ~30ms calcula RMS y, si `_capturing`, copia a `_buffer`. NO toca el bus directamente — emite via callback `on_level`. | `Recorder.start_stream()` (`audio.py:64`) | `stop_stream()`. |
| watchdog `Observer` daemon | Mira `commands.yaml` en disco; en `on_modified` programa `reload_config` con debounce de 300ms via `threading.Timer`. | `_start_watchdog` (`runtime.py:646`) | `Observer.stop()`+`join(2s)`. |
| HOTAS `hotas-<idx>` thread (1 por gamepad) | Bloquea en `gp.read()`; forwarda press/release del botón bindeado a callbacks. Si el device desaparece duerme 5s y reintenta. | `HotasListener.start()` (`hotas.py:80`). Daemon. | `stop()` setea `_stop` event, pero `gp.read()` puede seguir bloqueado — los threads son daemon, mueren con el proceso (ver Limitaciones). |
| `piper.exe` subprocess | Spawned por cada `say()`. Lee texto por stdin, escribe PCM int16 22050Hz mono por stdout. Stderr ignorado. | `PiperTTS.say()` (`tts.py:79`). NO es un thread Python: subproceso del SO. | `proc.wait(timeout=0.5)` o `terminate()` en cancel/shutdown. |
| Subscriber callbacks del bus | Corren sincrónicamente en el thread del emisor. UI subscribers re-emiten Qt signals (cross-thread → `QueuedConnection`). | `EventBus.subscribe()` | desubscripción / shutdown. |

## 5. EventBus contract

Definido en `origin/engine/events.py`. 15 tipos de eventos enumerados en `EventType`. Pattern: emisor llama `bus.emit(event, payload_dict)`, suscriptores reciben el `dict` plano. Sin lock por subscriber — un subscriber colgado bloquea al emisor.

| Evento | Emitter | Payload | Consumer típico |
|---|---|---|---|
| `ENGINE_STATE_CHANGED` | `Orchestrator._set_state` | `{state: str}` | Dashboard, tray icon, header dot. |
| `AUDIO_LEVEL` | `Recorder` callback | `{rms: float}` | `VuMeter` widget. |
| `TRANSCRIPTION_DONE` | `_process_audio` | `{text, language, elapsed_ms}` | `TranscriptionLog`. |
| `MATCH_DONE` | `_process_audio` tras `IntentMatcher.match` | `{text, command_id, score, phrase, keys, elapsed_ms}` | Dashboard, log. |
| `COMMAND_EXECUTED` | `_dispatch_command` finally | `{command_id, keys, steps_count, dry_run, test}` | Dashboard last-exec. |
| `PROFILE_CHANGED` | `set_active_profile` / `cycle_profile` | `{profile_id}` | Header combo, tray menu. |
| `LANGUAGE_CHANGED` | `set_active_language` | `{lang}` | Header lang buttons. |
| `CONFIG_RELOADED` | `reload_config` ok | `{}` | Editor refresh, banner info. |
| `CONFIG_ERROR` | LLM preflight, save fail, reload fail | `{error, kind?}` | Banner rojo. |
| `LOG` | (reservado; sin emisores actualmente) | `{...}` | LogsViewer. |
| `TTS_STARTED` | `PiperTTS.say` | `{text, lang}` | Dashboard. |
| `TTS_DONE` | `PiperTTS.say` finally | `{text, cancelled?, error?, voice?}` | Dashboard. |
| `HOTAS_BUTTON_PRESSED` | `_start_hotas_listener` (init) | `{event, binding}` | Settings capture UI. |
| `LLM_INTENT_RESOLVED` | `_process_audio` post-LLM | `{transcription, command_ids, confidence, reasoning}` | Dashboard. |
| `SCRIPT_STEP_EXECUTED` | `StepExecutor._run_block` | `{type, pc}` | Debugging / tests. |

## 6. Schema `commands.yaml` v3

Modelo Pydantic v2 frozen en `origin/engine/config.py`. Root `CommandsFileV3` con campos `version`, `settings`, `profiles`. Acepta `version: 2` o `3` (v2 carga con defaults nuevos para `tts`/`hotas`/`llm`).

```yaml
version: 3
settings:
  ptt_key: f12
  profile_switch_hotkey: ctrl+f12
  ui_language: es                 # idioma de la GUI (es|en)
  active_profile: flight
  active_language: es             # idioma para STT + matcher + TTS (cambiable runtime)
  whisper_model: small            # tiny|base|small|medium|large-v3
  whisper_device: auto            # auto|cpu|cuda
  whisper_compute_type: auto      # auto|int8|int8_float16|float16|float32
  fuzz_threshold: 75              # 0..100; mínimo score para auto-dispatch
  mic_device: null                # int|null (default device)
  sample_rate: 16000
  max_record_seconds: 8
  inter_key_delay_ms: 30
  log_format: pretty              # pretty|json
  start_minimized: false
  autostart_windows: false
  theme: system                   # system|light|dark
  tts:
    enabled: true
    voice_es: "es_ES-mls_10246-low"
    voice_en: "en_US-amy-low"
    default_response_when_no_say: true   # si no hay say_*, usa label como ack
    cancel_on_ptt: true                  # PTT durante SPEAKING corta TTS y graba
    speed: 1.0                           # 0.5..2.0  (length_scale = 1/speed)
    volume: 1.0                          # 0.0..1.5  (gain lineal sobre PCM)
  hotas:
    enabled: false
    button_binding: null                 # "<device_idx>:<button_code>"
    poll_hz: 60                          # 10..240
  llm:
    enabled: false
    base_url: "http://localhost:11434"
    model: "llama3.1:8b"
    timeout_ms: 8000                     # 500..60000
    floor_score: 60                      # 0..100; LLM solo si floor ≤ score < threshold
    temperature: 0.2
    max_commands_per_resolution: 5
profiles:
  - id: flight
    label_es: "Vuelo"
    label_en: "Flight"
    description_es: "..."
    commands:
      - id: request_landing
        phrases_es: ["pide hangar", "solicita aterrizaje"]
        phrases_en: ["request landing"]
        keys: ["alt+n"]
        say_es: "permiso de aterrizaje solicitado"
        say_en: "landing requested"
```

Validaciones (Pydantic + custom validators):
- `id` (comando + perfil): regex `^[a-z][a-z0-9_]{0,31}$`.
- `phrases_es` o `phrases_en`: al menos una no vacía.
- `keys` o `steps`: al menos uno definido.
- `keys[i]`: regex `^[a-z0-9_+]+$` (validación real de tecla vía `keypress.parse_combo`).
- `cond` en `if`: regex `^var (op) rhs$` con `op ∈ {==, !=, >, <, >=, <=}`.
- `MAX_STEPS_PER_COMMAND = 100` (`config.py:29`) — `_count_steps` expande `repeat × times` y suma sub-bloques de `if/then/else`. Si excede, `ValidationError` en load.
- `settings.active_profile` debe existir en `profiles`.
- `extra="forbid"` en todos los modelos — typos en YAML fallan loud.

Persistencia: `save_atomic` (`config.py:497`) escribe a `tempfile.mkstemp` y hace `os.replace` → no se corrompe si el proceso muere a mitad. `to_dump` usa `by_alias=True` para que `IfStep.else_` se serialice como `else:` (consistente con YAML escrito a mano).

Migración (`config.py:382`):
- **v1 → v3**: `_migrate_v1_to_v3` colapsa `commands:` flat en un perfil `default`, renombra `language` → `active_language`, defaultea `ui_language`/`profile_switch_hotkey`. Backup `commands.v1.backup.yaml` al lado.
- **v2 → v3**: el schema v3 acepta `version: 2` literal; defaults de `tts`/`hotas`/`llm` se inyectan via `default_factory`. Pre-flight backup `commands.v2.backup.yaml` siempre.

## 7. Step types del DSL

Discriminator `type:` (Pydantic `Annotated[Union, Field(discriminator="type")]`). Sub-steps recursivos en `if.then`/`if.else`/`repeat.steps`.

| `type`     | Params                                            | Semántica |
|------------|---------------------------------------------------|-----------|
| `key`      | `combo: str`, `hold_ms: int? (0..10000)`          | Envía combo vía `pydirectinput.press`. Si `hold_ms`, usa `execute_held`. |
| `wait`     | `ms: int (0..30000)`                              | `cancel.wait(ms/1000)` — cancelable. |
| `say`      | `text? | text_es? | text_en?` (al menos uno)      | Resuelve por idioma activo (fallback al otro), llama `tts_say`. Sub-state SPEAKING. |
| `say_key`  | `key: str`                                        | Busca `key` en `tts_phrases_{lang}.json`. `[missing:key]` si no existe. |
| `set`      | `var: str (VAR_RE)`, `value: str`                 | Setea `state.vars[var] = value`. Per-profile, persiste entre invocaciones. |
| `if`       | `cond: str`, `then: list[Step]`, `else: list[Step]?` | `eval_cond` sin Python eval — solo `var op rhs`. Numérico si ambos parseables. |
| `goto`     | `label: str`                                      | Salta a `LabelStep` con `name == label` en el mismo bloque. Sin label → log warning, sigue. |
| `label`    | `name: str`                                       | No-op en ejecución; indexado en `_index_labels`. |
| `repeat`   | `times: int (1..20)`, `steps: list[Step]`         | Re-corre el inner block `times` veces; cancela en cada vuelta. |

Ejecutor en `engine/script.py:77`. Reglas anti-runaway:
- Contador `_steps_run` global por `execute()`. Si llega a `MAX_STEPS_PER_COMMAND` (100), aborta con log warning. Cubre loops infinitos por `goto`.
- `cancel: threading.Event` chequeado en cada iteración y dentro de `wait`. Shutdown setea `_script_cancel` antes de cualquier otra cosa (`runtime.py:139`).
- `vars` per-profile sobreviven entre comandos del mismo perfil; se limpian al borrarse el perfil (`reload_config`).

Ejemplo `steps:` mixto:

```yaml
- id: scan_and_engage
  phrases_es: ["escanea y ataca"]
  steps:
    - {type: key, combo: tab}
    - {type: wait, ms: 500}
    - {type: set, var: target_count, value: "1"}
    - type: if
      cond: "target_count > 0"
      then:
        - {type: say_key, key: tts.target_locked}
        - {type: repeat, times: 3, steps: [{type: key, combo: space}, {type: wait, ms: 120}]}
      else:
        - {type: say, text_es: "sin objetivo", text_en: "no target"}
```

## 8. Flujo PTT end-to-end

Caso: `phrases_es: ["pide hangar"]`, `keys: ["alt+n"]`, `say_es: "permiso solicitado"`.

1. **PTT down** (`F12`). `pynput.Listener` daemon llama `_on_ptt_press` (`runtime.py:453`).
2. Bajo `_state_lock`: si `BUSY/PAUSED/LOADING/ERROR` → return; si `SPEAKING` + `cancel_on_ptt` → `PiperTTS.cancel()`. Setea `_ptt_pressed = True`, `_capture_started_at = monotonic()`, `Recorder.begin_capture()`, `state = RECORDING`.
3. **Audio acumulándose**: PortAudio callback en su propio thread mete `np.copy` del bloque (~30ms) en `_buffer`. Emite RMS al VU meter.
4. **PTT up**. `_on_ptt_release` (`runtime.py:475`). Cierra `Recorder.end_capture()` → `np.ndarray`. Si dur < `_MIN_RECORD_SECONDS` (0.3s) → vuelve a `READY`. Si OK: `state = TRANSCRIBING`, submit `_process_audio` al `origin-stt` executor.
5. **Worker thread**: `Transcriber.transcribe(audio, lang)` corre `faster-whisper` con `vad_filter=True`, `beam_size=5`. Emite `TRANSCRIPTION_DONE`. Si CUDA OOM, downgrade a CPU on the fly.
6. **Match**: `IntentMatcher.match(text, lang, threshold)` (cached por perfil activo). Best score con `rapidfuzz.fuzz.token_set_ratio` sobre frases normalizadas (NFKD + lowercase + collapse whitespace). Emite `MATCH_DONE`.
7. Si `result.command is not None`: `_dispatch_command`. Si no, ver §9 (LLM fallback).
8. **`_dispatch_command`**: `state = RUNNING_SCRIPT`. `command_as_steps(cmd, settings)` traduce `keys: ["alt+n"]` a `[KeyStep("alt+n"), SayStep(text="permiso solicitado")]` (más `WaitStep(inter_key_delay_ms)` si hay múltiples keys).
9. **StepExecutor.execute**: itera. `KeyStep` → `keypress.execute(["alt+n"], 30)` → `pdi.keyDown("alt")`, `pdi.press("n")`, `pdi.keyUp("alt")`. Star Citizen recibe el evento DirectInput.
10. `SayStep` → `set_substate("speaking")` → `PiperTTS.say("permiso solicitado", "es")`. Spawn `piper.exe`, escribe texto a stdin, `_play_stream` lee stdout en chunks de 4096 bytes y los empuja a `sd.RawOutputStream` (chequeando `cancel` por chunk). Emite `TTS_STARTED` y `TTS_DONE` al final.
11. Step executor termina. `_dispatch_command` emite `COMMAND_EXECUTED` en `finally`.
12. **`_on_process_done`** (callback del `Future`): bajo `_state_lock`, si no es `PAUSED/ERROR` → `state = READY`.

Tiempos típicos (Whisper small, CPU int8): paso 5 ≈ 250-600ms; pasos 6+9 < 5ms; paso 10 (TTS) ≈ 300ms desde spawn hasta primer audio.

## 9. LLM fallback

Trigger (`runtime.py:546`):

```python
if (self._llm is not None
    and llm_cfg.enabled
    and text.strip()
    and llm_cfg.floor_score <= result.score < threshold):
    self._set_state(State.RESOLVING_INTENT)
    resolution = self._llm.resolve(text, prof, lang)
```

Window: el mejor score quedó por debajo de `fuzz_threshold` (no es match) pero por encima de `floor_score` (la transcripción se "parece" a algo). Defaults: `floor=60`, `threshold=75`. Score < 60 → ignoramos (probable ruido/non-command). Score ≥ 75 → ya disparamos.

Prompt schema (`llm.py:118`): system message con catálogo del perfil activo en formato `- <id> — <label> — "<frase>", "<frase>"...` (hasta 3 frases por comando). User message es la transcripción cruda. Respuesta JSON forzada con `format: "json"` de Ollama:

```json
{ "commands": ["target_crusader", "engage_quantum"],
  "confidence": "high" | "medium" | "low",
  "reasoning": "<one short sentence>" }
```

Validación post-respuesta: `IntentResolution.model_validate` + filtro de IDs (solo los que existen en el catálogo) + corte a `max_commands_per_resolution`. Si `confidence != "low"` y `commands` no está vacío, se ejecutan en orden vía `_dispatch_command`. Emite `LLM_INTENT_RESOLVED` siempre (también `low`/empty para visibilidad en el dashboard).

Preflight no-bloqueante al startup (`_llm_preflight`): `GET /api/tags`, verifica que el modelo esté pulled. Falla → banner amarillo via `CONFIG_ERROR` con `kind: "llm"`. Nunca rompe el startup del engine.

## 10. Persistence model

| Path | Contenido | Quién escribe |
|---|---|---|
| `%APPDATA%/Origin/commands.yaml` | Perfiles + settings (editable a mano). | App vía `save_atomic`; usuario vía editor externo. |
| `%APPDATA%/Origin/commands.v1.backup.yaml` | Backup pre-migración v1. | `_save_backup` (idempotente). |
| `%APPDATA%/Origin/commands.v2.backup.yaml` | Backup pre-load de v2. | idem. |
| `%APPDATA%/Origin/voices/*.onnx` + `*.onnx.json` | Voces TTS instaladas por el usuario (override sobre las bundled). | usuario (drop manual). |
| `%APPDATA%/Origin/logs/origin.log` | Log rotativo. `RotatingFileHandler` 5MB × 3 backups. | `logging_setup.setup`. |
| `%APPDATA%/Origin/.lock` | `QLockFile` single-instance. | `ui/app.py:_single_instance_lock`. |
| `%APPDATA%/Origin/piper/piper.exe` | Override de Piper en dev (si no hay bundle). | usuario. |
| `sys._MEIPASS/piper/piper.exe` | Piper bundled (PyInstaller frozen). | build pipeline. |
| `sys._MEIPASS/voices/*` | Voces bundled. | build pipeline. |
| `sys._MEIPASS/models/Systran--faster-whisper-<size>/` | Modelo Whisper bundled. | build pipeline. |
| `sys._MEIPASS/commands.preset.yaml` | Preset copiado a `%APPDATA%` al primer arranque (`ensure_preset`). | build pipeline. |
| `sys._MEIPASS/origin/ui/i18n/{es,en}.json` | Strings UI bundled. | build. |
| `sys._MEIPASS/origin/engine/tts_phrases_{es,en}.json` | Frases TTS bundled. | build. |

En Linux/macOS dev: `%APPDATA%/Origin` → `~/.config/origin` (`paths.py:_default_base`).

## 11. Resource discovery order

`paths.py` define el orden de búsqueda. Idea: bundled gana si está frozen; dev/user puede sobreescribir.

| Recurso | Orden de búsqueda |
|---|---|
| `piper.exe` (`piper_exe_path`) | 1) `sys._MEIPASS/piper/piper.exe` si frozen — 2) `%APPDATA%/Origin/piper/piper.exe` — 3) `%APPDATA%/Origin/piper/piper` (Linux dev). Devuelve `None` si no encuentra. |
| Voces bundled (`bundled_voices_dir`) | 1) `sys._MEIPASS/voices` si frozen — 2) `<repo>/installer/voices` (dev). Las voces de usuario van aparte en `default_paths().voices_dir`. `PiperTTS._resolve_voice` chequea **user dir primero**, luego bundled. |
| Modelo Whisper (`stt._bundled_models_dir`) | Solo si frozen: `sys._MEIPASS/models/`. Pasado como `download_root` a `WhisperModel` → `faster-whisper` lo encuentra ahí en vez de bajarlo de HuggingFace en el primer arranque. |
| `commands.preset.yaml` (`__main__.ensure_preset`) | 1) `bundled_resource_dir()/commands.preset.yaml` — 2) `<repo>/commands.preset.yaml` (dev). Se copia a `%APPDATA%/Origin/commands.yaml` si no existe. |
| i18n UI (`ui/i18n/tr.py`) | `Path(__file__).parent / "{lang}.json"`. En frozen, PyInstaller lo coloca en `sys._MEIPASS/origin/ui/i18n/`. |
| TTS phrases (`engine/runtime._load_tts_phrases`) | `Path(__file__).parent / "tts_phrases_{lang}.json"`. Mismo patrón. |

## 12. Hot-reload

`watchdog.observers.Observer` monitorea el directorio de `commands.yaml` (recursive=False). Handler debouncea con 300ms via `threading.Timer` para colapsar saves rápidos (la mayoría de editores hacen write+rename y disparan 2-3 eventos).

`reload_config` (`runtime.py:295`):
1. Re-parsea con `cfgmod.load`. Si falla → `CONFIG_ERROR` banner, return.
2. Bajo `_state_lock`: swap `self._cf`, `self._settings`. `ProfileRegistry.replace_config` actualiza su matcher cache; si el perfil activo desapareció, cae al `active_profile` del nuevo settings o al primero.
3. Limpia `_script_states[k]` para perfiles que ya no existen. **Los `vars` de perfiles que siguen existiendo se preservan** — un comando con `set: count` no pierde el contador por un save del YAML.
4. Emite `CONFIG_RELOADED`. UI re-pinta combo de perfiles y muestra banner info.

No se rebuildean Whisper, Piper, listeners de teclado/HOTAS — eso lo hace `set_setting` cuando el cambio viene desde la UI (que conoce qué subsistemas tocar). Si el usuario edita `whisper_model` a mano en el YAML, el hot-reload actualiza `self._settings` pero el `Transcriber` sigue con el modelo viejo cargado hasta que se rebuildee desde Settings.

## 13. Internacionalización (dos sistemas separados)

**Por qué dos**: el engine no puede depender del módulo i18n de la UI (es sin Qt y testeable headless). Las frases que dice el engine vía `SayKeyStep` necesitan vivir junto al engine. Mantener separados evita import cycles y permite a un futuro frontend distinto reusar el engine sin las strings de Qt.

| Sistema | Ubicación | Cargado por | Uso | Fallback |
|---|---|---|---|---|
| **UI i18n** | `origin/ui/i18n/{es,en}.json` | `ui/i18n/tr.py:load(lang)` | `tr("sidebar.dashboard")` en widgets. Páginas se registran via `register_retranslatable(callback)` para repintar en cambio de idioma. | clave en EN faltante → ES, ES faltante → key raw. |
| **Engine TTS phrases** | `origin/engine/tts_phrases_{es,en}.json` | `runtime._load_tts_phrases(lang)` al construir Orchestrator. | `SayKeyStep(key="tts.target_locked")` → busca en el dict del idioma activo. | Si falta → `"[missing:key]"` (no crashea, visible para debugging). |

El idioma de la UI (`ui_language`) y el idioma activo de voz/STT (`active_language`) son independientes: podés tener la GUI en EN y hablarle en ES.

## 14. Build pipeline

`installer/build_installer.ps1` orquesta:

| Paso | Acción | Salida |
|---|---|---|
| [0/3] | Descarga `piper_windows_amd64.zip` de `rhasspy/piper`, lo expande en `installer/piper/`. Descarga voces ONNX (`es_ES-mls_10246-low`, `en_US-amy-low`) de HuggingFace `rhasspy/piper-voices` a `installer/voices/`. | `installer/piper/piper.exe`, `installer/voices/*.onnx`. |
| [1/4] | `uv run python -c "from huggingface_hub import snapshot_download..."` baja el modelo Whisper `Systran/faster-whisper-<size>` a `installer/models/`. Idempotente. | `installer/models/Systran--faster-whisper-<size>/`. |
| [2/4] | `uv run pyinstaller installer/origin.spec --noconfirm` (onedir mode). Limpia `build/` y `dist/` antes. | `dist/Origin/Origin.exe` + dlls + datas. |
| [3/4] | `ISCC.exe installer/origin.iss` compila el instalador. | `dist/OriginSetup-<version>-<model>-v3.exe`. |

PyInstaller spec (`installer/origin.spec`):
- `datas`: copia i18n, assets, `commands.preset.yaml`, `tts_phrases_*.json`, `models/`, `piper/`, `voices/`.
- `hiddenimports`: `ctranslate2`, `faster_whisper`, `sounddevice._sounddevice`, `pydirectinput`, `pynput.keyboard._win32`, `pynput.mouse._win32`, `tokenizers`, `watchdog.observers.{read_directory_changes,winapi}`, `httpx`, `inputs`.
- `excludes`: `tkinter`, `matplotlib`, `scipy` (reducción de bundle size).
- `console=False` (no consola flotante).

Inno Setup (`installer/origin.iss`):
- `DefaultDirName={localappdata}\Programs\Origin` (no requiere admin: `PrivilegesRequired=lowest`).
- Task opcional `autostart` que escribe `HKCU\...\Run\Origin = "<app>\Origin.exe" --tray`.
- Task `desktopicon`.

CI (`.github/workflows/origin-release.yml`):
- Trigger: push de tag `origin-v*` o `workflow_dispatch` con choice de modelo.
- Runner: `windows-latest`, Python 3.12, `uv sync --extra dev`.
- Cachea el modelo Whisper entre runs con `actions/cache@v4` key `whisper-<model>-v1`.
- `choco install innosetup --yes`, después `pwsh installer/build_installer.ps1 -Model $env:MODEL`.
- Upload artifact siempre; en tag, crea GitHub Release con `softprops/action-gh-release@v2`.

## 15. Tests

122 tests `def test_*` totales (output de `grep -c "def test_"`). División:

- **Engine** (~78): `tests/engine/test_*.py`. Cobertura por módulo: `config` (incluyendo `test_config_v3`, `test_migration_v1_v2`), `intent`, `keypress`, `tts`, `llm`, `hotas`, `i18n_loader`, `profiles`, `runtime_regressions`, `script_executor`, `events`, `autostart_windows`, `preset`.
- **UI** (~44, marcados `gui`): `tests/ui/test_*.py` con `pytest-qt`. Cubren `main_window`, `commands_editor`, `profiles_manager`, `script_editor`, `settings_language_toggle`, `settings_ptt_capture`, `tray`.

Correr todo: `pytest tests/`. Solo engine (sin display): `pytest tests/engine/`. Battery exploratoria/ad-hoc en `/tmp/ultra_audit.py` que recorre los flujos end-to-end (~50 escenarios) — no integrada en CI, usar para smoke pre-release.

Mocks típicos:
- `pydirectinput` no instalado en Linux → `keypress.execute` loguea warning y skipea; los tests verifican el log o mockean `_get_pdi`.
- `inputs` (HOTAS) — `tests/engine/test_hotas.py` inyecta un fake.
- `winreg` (autostart) — `test_autostart_windows.py` mockea o skipea si no es Windows.
- `httpx` mockeado con `pytest-httpx` para LLM.

## 16. Decisiones arquitectónicas con tradeoffs

| Decisión | Por qué | Tradeoff |
|---|---|---|
| Engine sin Qt | Testabilidad headless en CI Linux; reusabilidad para frontend alternativo. | Bridge layer (`EngineBridge`) explícito; emisores en threads no-UI exigen `QueuedConnection`. |
| `EventBus` propio en vez de `QSignal` directo | Igual razón ↑; emit es no-bloqueante y sin GIL contention con Qt. | Subscriber roto puede bloquear emisor (mitigado con try/except por listener). |
| PyInstaller **onedir**, no onefile | Onefile desempaqueta a `%TEMP%` en cada cold-start; con modelo Whisper de 240-3000 MB son 5-30s extra. Onedir cold-start < 2s. | Instalador "más sucio" (carpeta con DLLs) — aceptable, está en `Programs\Origin`. |
| `piper.exe` binary, **no** `piper-tts` pip package | El paquete pip arrastra ONNX runtime + DLLs que chocan con ctranslate2 en PyInstaller (DLL hell). El binary es un .exe standalone. | Spawn cost por `say()`; aceptable (~50ms). |
| `inputs` (pure Python), **no** `pygame.joystick` | `pygame` arrastra SDL2 + 80 MB de deps. `inputs` es < 50 KB pure Python sobre `XInput`. | `gp.read()` es bloqueante → un thread por device, no se puede unblock limpio (ver §18). |
| `pydirectinput` (DirectInput), **no** `keyboard`/`SendInput` | Star Citizen consume DirectInput; `keyboard` / `SendInput` no llegan al juego en ventana fullscreen. | Windows-only; tests mockean en Linux. |
| Pydantic v2 **frozen** + `extra="forbid"` | Detecta mutaciones accidentales (Pydantic levanta `ValidationError`); typos en YAML son loud. | `with_settings(**changes)` requiere `model_copy` explícito; un poco más verboso. |
| `ThreadPoolExecutor(max_workers=1)` para STT | El modelo de Whisper no es thread-safe entre `transcribe()` concurrentes (`stt.py:46`). Un solo worker serializa de forma natural y respeta el orden de PTTs. | Si llega un PTT mientras un comando aún ejecuta, queda como `ptt_busy`; aceptable para el use-case (PTT discreto). |
| Hot-reload con debounce 300ms | La mayoría de editores hacen write+rename → 2-3 eventos. Debounce evita doble-load. | Cambios consecutivos a < 300ms se colapsan en uno. |
| `save_atomic` (tmp + rename) | Si el proceso muere a mitad del write, el YAML viejo queda intacto. | Trivial overhead (`os.replace` es atómico en NTFS). |
| Voces TTS y modelo Whisper **bundled** en el installer | Sin internet en el primer arranque, app usable inmediato. | Instalador pesa ~600 MB (small) hasta ~3.5 GB (large-v3). |

## 17. Cosas que NO funcionan en Linux

Origin es Windows-first. Estos módulos están condicionados o stubeados:

- `pydirectinput` — declarado `; sys_platform == 'win32'` en `pyproject.toml`. `keypress._get_pdi()` retorna `None` en Linux y `execute()` loguea warning sin enviar nada.
- `inputs` — idem; `HotasListener.start` retorna sin hacer nada si `_try_import_inputs` devuelve `None`.
- `autostart_windows` — `is_supported()` chequea `sys.platform == "win32"`; todas las funciones son no-op.
- `pynput.keyboard._win32` — el listener funciona en Linux con `_xorg` pero hace falta server X corriendo. CI lo skipea por marker `gui`.
- `winreg` — import condicional dentro de las funciones que lo necesitan.

Imports lazy en `runtime.py`: `pynput.keyboard`, `sounddevice`, `watchdog`, `faster_whisper`. Esto permite que tests de configuración carguen sin tener las deps nativas instaladas.

## 18. Limitaciones conocidas v0.3

- **HOTAS thread leak al rebindear**: `HotasListener.stop()` setea el event pero `gp.read()` queda bloqueado hasta el próximo evento del device. El thread es daemon, muere con el proceso, pero rebindes en runtime acumulan threads zombie hasta cerrar la app. Workaround: cerrar y reabrir Origin tras cambiar `hotas.button_binding` repetidas veces.
- **No mouse input**: `pydirectinput` soporta mouse pero el DSL solo expone `KeyStep`. Comandos que requieren clic deben hacerse con macros del juego.
- **Hold-key solo via step explícito**: `KeyStep(combo="b", hold_ms=500)` funciona; el PTT en sí es tap (la "duración" del PTT marca solo la ventana de grabación, no se traduce a hold-key).
- **LLM requiere Ollama corriendo aparte**: no hay LLM embebido. El usuario debe instalar Ollama, hacer `ollama pull llama3.1:8b` (o el modelo configurado), y dejar el servicio escuchando en `base_url`. Sin Ollama → preflight banner, fallback silencioso (mejor score < threshold → no acción).
- **Sub-steps de `if`/`repeat` NO editables desde `ScriptEditorDialog`**: el editor visual maneja step types planos (key/wait/say/say_key/set/goto/label). Para `if.then`, `if.else`, `repeat.steps` hay que editar `%APPDATA%/Origin/commands.yaml` a mano. El hot-reload toma el cambio al guardar (`origin/ui/widgets/script_editor.py:1-9`).
- **Solo `IfStep` y `RepeatStep` se cuentan en `MAX_STEPS_PER_COMMAND`**: `goto` que crea loop sin `repeat` se atrapa en runtime (`_steps_run >= 100`), no en validación de config. Síntoma: comando se corta a mitad con `script_step_limit_reached` en logs.
- **`watchdog` en Linux con NFS**: no detecta cambios en filesystems no-inotify. `import` opcional, se desactiva con log `watchdog_unavailable hot_reload_disabled`.
- **Cambio de mic device durante grabación se descarta**: `Recorder.restart_stream` limpia el buffer en vuelo intencionalmente (sin esto mezclaba audio de mic viejo + nuevo). Usuario pierde la grabación parcial — aceptable y poco común.
- **State `EXECUTING` es legado v0.2**: aparece en la enum pero el runtime v0.3 lo cubre con `RUNNING_SCRIPT`. Solo se setea desde `execute_command_test` cuando el comando viene del botón Test del editor — el state final tras el test vuelve a `READY` en `finally`.
