# Hermes — Crew Health Monitoring

A PHP dashboard with English navigation, live readings, offline SVG charts, and persistent history for all 26 telemetry measurements.

## Start on Windows

To set up a new host, extract the ZIP and run **`INSTALL_AND_START.bat`**. See `WINDOWS_SETUP.txt` for the local, Tailscale, and Python API options.

If PHP is already available, you can also start manually:

1. Extract the complete `hermes` folder.
2. Double-click **`START.bat`**. It starts PHP and opens `http://localhost:8080`.
3. If PHP is not in `C:\php\php.exe` or your PATH, edit `PHP_EXE` in the launcher.

PHP 8.0 or later is required. The built-in simulator needs no Python, database extension, internet connection, or chart CDN. Keep the server window open; press Ctrl+C to stop it.

From a terminal, inside the `hermes` folder:

```sh
php -S 0.0.0.0:8080 -t web
```

Serve **only `web/`** as the document root. The `storage/` folder must be writable and stays outside the public document root.

## Dashboard

Open `index.php` and choose **General view**, **Data view**, or **Graph view**. General view (the default) shows the whole crew at once: a crew status bar, the average crew health index, active alerts, and the cabin average; one card per astronaut with a body-systems heatmap (head, lungs, heart, core, arms, legs), a health index ring, system score bars, key vitals, and 5-minute heart rate and SpO₂ sparklines; and a crew comparison heatmap of all 26 measurements. **Open data view** on a card selects that astronaut in Data view. Data view keeps the physiology, biometric, and environment cards. Graph view shows the historical trend of every measurement; use the category selector to narrow the display. The preference is remembered in the browser; `?view=general`, `?view=data`, and `?view=graphs` explicitly select a view.

Select a crew member using their name and portrait button. The three demo identities are shared by built-in and Python API modes, and their portraits are fictional. Crew selection and the four scenario buttons update without a page reload. Each scenario applies only to the selected crew member. In built-in mode every browser also gets its own private simulation and history (identified by a `hermes_viewer` cookie), so people viewing the same address never change each other's scenario. The source badge identifies built-in simulation or the telemetry API. The last-reading label uses UTC and flags readings older than 10 seconds.

Each system page has working charts for the measurements actually collected. ECG waveforms and sleep stages are not collected, so those placeholder charts have been replaced by recorded metrics. **Mission alerts** shows active rule-based alerts from the entire crew on every page, with the astronaut's name and the highest severity first. The optional local AI assistant is a floating button on every page and responds to explicit requests.

## Statistics

Open **Statistics** (`statistics.php`).

- Select a crew member and the last five minutes, last hour, last 24 hours, all history, or custom UTC dates.
- Explore any of the 26 metrics in a large history chart and an observed histogram with a fitted normal probability density curve.
- Compare sample count, latest value, mean, sample standard deviation, minimum, and maximum for every metric.
- View all 26 historical charts and inspect all measurement columns in the historical table.
- Export **all rows in the selected range** to CSV, including all 26 fields, record ID, astronaut ID, UTC timestamp, and scenario. Export is disabled while a history load is incomplete.

History is fetched in pages of 1,000 records until every matching page has loaded. This is a transfer page size, not a retention limit. Live readings update each second; history reconciliation runs every 10 seconds to recover samples missed between polls or while another page was open. Changing the crew or range cancels the old history request.

The table shows 25 rows per page. Moving between pages freezes that table snapshot; enable **Follow latest** to return to the live first page. CSV always exports the current complete selected range, even when the table is frozen.

### How the statistics are calculated

Mean and sample standard deviation use all finite numeric samples for each metric; missing values are excluded, not changed to zero. The histogram is normalized as a probability density, and the fitted curve uses the same mean and sample standard deviation (denominator `n − 1`). A normal fit is descriptive, not a normality test or a clinical reference range. Cumulative counters and mixed scenarios may not be normally distributed.

With fewer than two samples, the fit is unavailable. Constant measurements have zero variance, so a continuous normal curve is undefined; Hermes displays an explicit message instead of an invented curve. Trend drawings retain extrema when simplifying large series. Statistics and CSV still use the full records.

## Health check-in

Open **Check-in** (`health_checkin.php`). It has two views.

**Crew summary** shows the latest check-in of everyone. *Crew overview* has one Mental health panel and one Ocular health panel with crew averages and the number of flagged crew members. *Individual crew members* has one card per person with a Mental block (wellbeing index, the four self-ratings, reaction time against baseline, and its trend) and an Ocular block (a thumbnail of each eye's grid, sharpness per eye, and symptoms). **Export CSV** downloads every stored check-in. With no data, **Load sample history** adds five days of marked sample check-ins; **Clear check-ins** removes everything.

**New check-in** takes about two minutes for the selected crew member:

- **Mind:** four 1–10 self-ratings, a five-trial reaction test, and an optional 30-second voice note. A tap before the target, or within 100 ms of it, is a false start and the trial repeats. A reaction over 500 ms is a lapse.
- **Eyes**, one eye at a time: a 20 × 20 Amsler grid where squares are marked as *wavy or bent* or *blurred or missing*, and a Tumbling E sharpness test for a 40 cm viewing distance. Each letter size passes with two correct answers and fails with two wrong ones. **Calibrate this screen** sets the true letter size with a bank card and is remembered per device. A screen cannot draw letters smaller than one pixel per stroke, so low-resolution screens stop at a larger size and say so.
- **Result:** the server compares the check-in with the personal baseline and returns a Mental status, an Ocular status, and the overall flag (the worse of the two).

The first check-in of a crew member becomes their baseline; tick **Use this check-in as my new baseline** to replace it. The limits are in `CK_LIMITS` in `web/checkin_lib.php`:

| Finding | Status |
|---|---|
| Reaction time 15% slower than baseline | Mental: amber |
| Reaction time 30% slower than baseline | Mental: red |
| Two or more lapses in one test | Mental: amber |
| Stress 8 or higher; energy, crew sync, or sleep quality 3 or lower | Mental: amber |
| One or more new distorted grid squares | Ocular: amber |
| Flashes, floaters, or double vision reported | Ocular: amber |
| Sharpness worse by 0.2 logMAR or more (logMAR rises as vision gets worse) | Ocular: red |
| New distorted squares together with flashes, floaters, or double vision | Ocular: red |

These are screening limits chosen for the demonstration, not clinical criteria.

### How check-ins join the rest of Hermes

- **Mission alerts:** a flagged check-in from the last 36 hours appears on every page as *Check-in · Mental* or *Check-in · Ocular*, and counts in the General view alert totals.
- **AI assistant:** the floating HERMES Crew AI Assistant can use each astronaut’s latest mental and ocular check-in, flagged findings, and changes from the personal baseline when available. Sample check-ins are identified. Audio stays in the check-in workflow.
- **Storage:** check-ins belong to the mission, so they are shared by all visitors even when telemetry simulations are private per browser. Built-in mode appends them to `storage/checkins/checkins.jsonl`; API mode stores them in the `checkins` table through `GET/POST /api/checkins` and `POST /api/checkins/clear`. Voice notes are files in `storage/checkins/audio/` in both modes.
- **Offline:** if the server cannot be reached, the check-in is kept in the browser and sent when the connection returns.
- **Mission day** is counted from `HERMES_MISSION_START`.

The microphone needs `localhost` or HTTPS (the Cloudflare and Tailscale launchers provide HTTPS).

## Persistent history

**Built-in mode:** full timestamped records are appended to `storage/history/crew-ID-YYYY-MM-DD.jsonl`; the simulator state is in `storage/state.json`. History survives refreshes and server restarts. Generation occurs when the web app is requested. After inactivity, at most 60 seconds are simulated on the next request; longer unobserved gaps are not filled. Keep a page active or use the Python generator for continuous acquisition.

**API mode:** the Python server keeps all records in `server/hermes_received.db` (SQLite). `GET /api/history` supports crew/date filters, UTC `start`/`end`, and stable `before_id` / `after_id` cursors. No history existed in the original attached ZIP; new full history starts when this version runs. Existing Python databases can be reused by setting `HERMES_DB_PATH` to their absolute path before starting the API. Existing records need the same telemetry schema.

Both modes retain history until you explicitly remove or archive it. Back up the `storage/` folder or the Python database while the servers are stopped. The browser loads the full selected range into memory; choose a narrower range for very large archives.

## Optional Python API mode

Double-click **`START_WITH_PYTHON.bat`**. This installs the packages in `requirements.txt` if needed and opens three windows: API, generator, and PHP. The launcher selects API mode automatically. Python 3.10 or later is required. The generator and API share `server/active_scenario_<id>.txt` (one file per crew member, falling back to `server/active_scenario.txt`) and should run from the same server folder.

Manual setup, from the project folder, in separate terminals:

```sh
python -m pip install -r requirements.txt
python -m uvicorn server.api:app --host 0.0.0.0 --port 8000
python server/generator.py
```

Then set `HERMES_DATA_SOURCE=api` in the PHP process environment, or change the fallback `'local'` to `'api'` in `web/config.php`, and start PHP. API documentation is at `http://localhost:8000/docs`.

| Setting | Purpose | Default |
|---|---|---|
| `HERMES_DATA_SOURCE` | PHP data mode | `local` |
| `HERMES_API_URL` | API address for PHP and generator | `http://127.0.0.1:8000` |
| `HERMES_API_KEY` | Shared key for PHP, API, and generator | `hermes-local-demo-key` |
| `HERMES_STORAGE_DIR` | Persistent built-in history directory. Setting it makes everybody share ONE simulation | Project `storage/` folder (per-visitor subfolders in `storage/viewers/`) |
| `HERMES_PER_VIEWER` | Set to `0` to share one simulation among all visitors | on |
| `HERMES_DB_PATH` | Python SQLite database | `server/hermes_received.db` |
| `HERMES_MISSION_START` | First mission day (UTC, `YYYY-MM-DD`) used for the check-in mission day | `2026-11-01` |
| `HERMES_AI` | Set to `0` to turn off the Ollama summary and questions | on |
| `HERMES_OLLAMA_MODEL` | Ollama model used for the summary | `llama3.2` |
| `HERMES_OLLAMA_URL` | Ollama address (keep it local; never publish it) | `http://127.0.0.1:11434` |
| `HERMES_AI_TTL` | Seconds a requested summary can be reused for the same crew and active scenarios (min. 15) | `60` |
| `HERMES_AI_LANGUAGE` | Language the model writes in | `English` |

Use a private key consistently across the three processes when configuring an API beyond the local demonstration. HTTPS connections use certificate verification.

## Checks

`node tests/statistics.test.js` checks summary statistics, density normalization, degenerate data, timestamp parsing, deduplication, CSV escaping, and peak-preserving simplification.

`python tests/test_api.py` checks the Python API with a temporary database; this test additionally needs `httpx`. `python tests/run_browser.py` starts isolated test servers, creates a temporary history fixture, and runs the browser smoke suite. It additionally needs Node.js, Playwright, and Chromium. Set `PHP_EXE` and `CHROMIUM_PATH` if their binaries are not at the defaults. Test screenshots and logs go to `test-results/` (or `HERMES_QA_DIR`).


## Local AI summary (optional, Ollama)

Select the round assistant button at the bottom right of any page, then **Request crew summary** to get a short summary of the latest readings for everyone. Install [Ollama](https://ollama.com) with `winget install Ollama.Ollama` and download a model with `ollama pull llama3.2`. If Ollama is unavailable, the request shows an error and the dashboard keeps working.

The dashboard contacts Ollama after a summary request or a submitted question. The summary is generated by a background process (`worker/ollama_worker.php`) so the PHP built-in server never blocks. Results can be reused on request within `HERMES_AI_TTL`, and at most two summaries are generated at once. AI text describes simulated data and should be used for information only.

### Ask the local AI

The question box can compare astronauts or answer about any crew member by name or ID while another is selected. The model uses the latest readings for the whole crew and the last two exchanges. Answers are plain text, take a few seconds, and the conversation resets when you change crew member. Each visitor can ask one question at a time and at most three AI jobs run at once. The assistant is told to stay on the dashboard topic, but it is a general model: if you publish Hermes, visitors use your PC's CPU/GPU. Turn it off with `HERMES_AI=0`.

Open **HERMES Crew AI Assistant** from any screen. Menu navigation keeps the conversation, draft, and pending reply in the same tab. The assistant uses recent telemetry statistics and the latest check-ins to answer relevant questions. It offers checks when the request warrants them.
