<div class="history-toolbar">
    <div class="field"><label for="history-range">Time range</label>
        <select id="history-range">
            <option value="5" <?= ($liveSection??'')!=='statistics'?'selected':'' ?>>Last 5 minutes</option>
            <option value="60">Last hour</option><option value="1440">Last 24 hours</option>
            <option value="all" <?= ($liveSection??'')==='statistics'?'selected':'' ?>>All recorded history</option>
            <option value="custom">Custom dates (UTC)</option>
        </select>
    </div>
    <div id="custom-range" class="custom-range" hidden>
        <div class="field"><label for="history-start">From (UTC)</label><input type="datetime-local" id="history-start" step="1"></div>
        <div class="field"><label for="history-end">To (UTC)</label><input type="datetime-local" id="history-end" step="1"></div>
        <button type="button" class="button" id="apply-range">Apply dates</button>
    </div>
    <button type="button" class="button secondary" id="refresh-history">Refresh history</button>
    <span class="history-feedback" id="history-feedback" role="status">Loading recorded history…</span>
</div>
