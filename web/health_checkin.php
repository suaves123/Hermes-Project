<?php
// Daily crew health check-in: mental (mood and reaction time) and ocular (grid and sharpness) screening,
// plus the crew and individual summaries. Check-ins are validated, assessed, and stored by checkin_api.php.
$pageTitle='Health check-in'; $liveSection='checkin'; $handleScenario=false;
require __DIR__.'/api_client.php';
include __DIR__.'/header.php';
?>
<div id="checkin-page">
<section class="page-head">
    <div><p class="eyebrow">DAILY CHECK-IN</p><h1>Crew health check-in</h1>
        <p class="muted">Mental and ocular screening in about two minutes, compared with each person's own baseline.</p>
        <p class="muted" id="crew-label"><?= htmlspecialchars($crew) ?></p></div>
</section>
<div class="control-bar">
    <div class="view-switch" role="group" aria-label="Check-in view">
        <button type="button" data-ck-view="summary" aria-pressed="true">Crew summary</button>
        <button type="button" data-ck-view="checkin" aria-pressed="false">New check-in</button>
    </div>
    <div class="ck-tools">
        <span class="ck-sync" id="ck-sync" aria-live="polite"></span>
        <button type="button" class="button secondary" id="ck-export" disabled>Export CSV</button>
        <button type="button" class="button secondary" id="ck-clear" disabled>Clear check-ins</button>
    </div>
</div>
<noscript><p class="notice">Enable JavaScript to use the health check-in.</p></noscript>

<!-- ===== Summary: crew overview and individual sections ===== -->
<section id="ck-summary" aria-live="polite"><p class="chart-empty">Loading check-ins…</p></section>

<!-- ===== New check-in ===== -->
<section id="ck-flow" class="ck" hidden>
    <p class="panel-note">This is a screening aid for mission monitoring, not a medical diagnosis.</p>
    <div class="view-switch ck-steps" role="group" aria-label="Check-in steps">
        <button type="button" data-step="1" aria-pressed="true">1 · Mind</button>
        <button type="button" data-step="2" aria-pressed="false">2 · Eyes</button>
        <button type="button" data-step="3" aria-pressed="false">3 · Result</button>
    </div>
    <div class="ck-meta"><span id="ck-baseline-info"></span><span>Elapsed <strong id="ck-elapsed">0:00</strong> · target 2:00</span></div>

    <div id="ck-step-1">
        <article class="panel ck-domain mental">
            <header class="panel-head"><span class="panel-icon bio" aria-hidden="true">◉</span><h2>How do you feel?</h2><span class="panel-tag">1–10</span></header>
            <div id="ck-sliders"></div>
        </article>
        <article class="panel ck-domain mental">
            <header class="panel-head"><span class="panel-icon bio" aria-hidden="true">⚡</span><h2>Reaction test</h2><span class="panel-tag">5 trials</span></header>
            <p class="ck-hint">Tap the dark area to start. Wait for the yellow target, then tap as fast as you can. Tapping before the target, or within a tenth of a second, counts as a false start and the trial repeats.</p>
            <canvas id="ck-pvt" class="ck-canvas" role="button" tabindex="0" aria-label="Reaction test area. Press to start, then press again when the target appears."></canvas>
            <div class="ck-stats" aria-live="polite">
                <div><span>Mean reaction</span><strong id="ck-pvt-mean">—</strong></div>
                <div><span>Median</span><strong id="ck-pvt-median">—</strong></div>
                <div><span>False starts</span><strong id="ck-pvt-fs">—</strong></div>
                <div><span>Lapses &gt; 500 ms</span><strong id="ck-pvt-lapses">—</strong></div>
            </div>
        </article>
        <article class="panel">
            <button type="button" class="button secondary" id="ck-audio-toggle" aria-expanded="false" aria-controls="ck-audio">＋ Add a voice note (optional)</button>
            <div id="ck-audio" hidden>
                <p class="ck-hint">Up to 30 seconds. The note is stored with the check-in for the flight surgeon.</p>
                <div class="ck-actions">
                    <button type="button" class="button" id="ck-rec">● Record</button>
                    <button type="button" class="button secondary" id="ck-rec-clear" hidden>Delete</button>
                </div>
                <p class="ck-hint" id="ck-rec-status" aria-live="polite"></p>
                <audio id="ck-rec-play" controls hidden></audio>
            </div>
        </article>
        <div class="ck-actions"><button type="button" class="button grow" data-go="2">Next: eyes →</button></div>
    </div>

    <div id="ck-step-2" hidden>
        <article class="panel ck-domain ocular">
            <header class="panel-head"><span class="panel-icon env" aria-hidden="true">◎</span><h2>Eye being tested</h2><span class="panel-tag">One at a time</span></header>
            <div class="view-switch ck-eye" role="group" aria-label="Eye being tested">
                <button type="button" data-eye="left" aria-pressed="true">Left eye</button>
                <button type="button" data-eye="right" aria-pressed="false">Right eye</button>
            </div>
            <p class="ck-hint" id="ck-eye-hint"></p>

            <h3 class="ck-sub">Grid test</h3>
            <p class="ck-hint">Look at the centre dot. Choose what you see, then tap or drag over those squares. Leave the grid empty if every line looks straight and complete.</p>
            <div class="view-switch ck-brush" role="group" aria-label="Kind of change to mark">
                <button type="button" data-brush="d" aria-pressed="true"><span class="ck-swatch d" aria-hidden="true"></span>Wavy or bent</button>
                <button type="button" data-brush="s" aria-pressed="false"><span class="ck-swatch s" aria-hidden="true"></span>Blurred or missing</button>
            </div>
            <canvas id="ck-amsler" class="ck-canvas" aria-label="Amsler grid, 20 by 20 squares. Mark the squares that look distorted."></canvas>
            <div class="ck-row"><span id="ck-amsler-count" aria-live="polite">0 squares marked</span><button type="button" class="button secondary" id="ck-amsler-clear">Clear grid</button></div>

            <h3 class="ck-sub">Sharpness test</h3>
            <p class="ck-hint">Hold the screen about 40 cm away (arm's length). Show which way the open side of the E points: use the arrows, the arrow keys, or swipe. Each size is shown two or three times.</p>
            <canvas id="ck-e" class="ck-canvas" aria-label="Tumbling E letter"></canvas>
            <div class="ck-dpad" role="group" aria-label="Direction of the E">
                <button type="button" data-dir="up" aria-label="Up" disabled>▲</button>
                <button type="button" data-dir="left" aria-label="Left" disabled>◀</button>
                <button type="button" data-dir="down" aria-label="Down" disabled>▼</button>
                <button type="button" data-dir="right" aria-label="Right" disabled>▶</button>
            </div>
            <div class="ck-row"><span id="ck-e-status" aria-live="polite">Not tested yet</span><button type="button" class="button" id="ck-e-start">Start sharpness test</button></div>
            <details class="ck-cal">
                <summary>Calibrate this screen (optional, once per device)</summary>
                <p class="ck-hint">Hold a bank card against the screen and move the slider until the bar is exactly as wide as the <strong>short side</strong> of the card. This sets the true size of the letters.</p>
                <div class="ck-cal-bar" id="ck-cal-bar"></div>
                <input type="range" id="ck-cal-range" min="120" max="620" step="1" value="204" aria-label="Width of the calibration bar">
                <div class="ck-row"><span id="ck-cal-status"></span><button type="button" class="button secondary" id="ck-cal-save">Save calibration</button></div>
            </details>
        </article>
        <article class="panel ck-domain ocular">
            <header class="panel-head"><span class="panel-icon env" aria-hidden="true">✚</span><h2>Any eye symptoms today?</h2></header>
            <div class="ck-pills" id="ck-symptoms" role="group" aria-label="Eye symptoms"></div>
        </article>
        <div class="ck-actions">
            <button type="button" class="button secondary" data-go="1">← Back</button>
            <button type="button" class="button grow" data-go="3">Next: review →</button>
        </div>
    </div>

    <div id="ck-step-3" hidden>
        <article class="panel" id="ck-review">
            <header class="panel-head"><span class="panel-icon ai" aria-hidden="true">✓</span><h2>Review</h2></header>
            <div class="table-scroll"><table class="data"><tbody id="ck-review-rows"></tbody></table></div>
            <label class="ck-check"><input type="checkbox" id="ck-set-baseline"> <span id="ck-set-baseline-label">Use this check-in as my new baseline</span></label>
            <p class="notice" id="ck-submit-error" hidden></p>
            <div class="ck-actions">
                <button type="button" class="button secondary" data-go="2">← Back</button>
                <button type="button" class="button grow" id="ck-submit">Submit check-in</button>
            </div>
        </article>
        <article class="panel" id="ck-result" hidden>
            <header class="panel-head"><span class="panel-icon ai" aria-hidden="true">✓</span><h2>Check-in result</h2><span class="panel-tag" id="ck-result-time"></span></header>
            <div class="ck-flag ok" id="ck-flag" role="status"><strong id="ck-flag-text"></strong><span id="ck-flag-note"></span></div>
            <div class="ck-blocks" id="ck-result-blocks"></div>
            <div class="table-scroll"><table class="data"><thead><tr><th>Measure</th><th>Baseline</th><th>Today</th><th>Change</th></tr></thead><tbody id="ck-compare"></tbody></table></div>
            <details class="ck-payload"><summary>Stored record</summary><pre id="ck-payload"></pre></details>
            <div class="ck-actions">
                <button type="button" class="button grow" data-ck-view="summary">View crew summary</button>
                <button type="button" class="button secondary" id="ck-new">New check-in</button>
            </div>
        </article>
    </div>
</section>
</div>
<?php include __DIR__.'/footer.php'; ?>
