<?php
$pageTitle='Statistics'; $liveSection='statistics'; require __DIR__.'/api_client.php'; include __DIR__.'/header.php';
?>
<section class="page-head">
    <div><p class="eyebrow">MISSION ANALYTICS</p><h1>Historical statistics</h1><p class="muted">Every measurement. Every recorded sample.</p><p class="muted" id="crew-label"><?= htmlspecialchars($crew) ?></p></div>
</section>
<div class="telemetry-meta"><span class="source-badge"><?= htmlspecialchars($sourceLabel) ?></span><span id="last-updated">Waiting for a reading…</span></div>
<div id="notice-slot"><?php include __DIR__.'/partials/notice.php'; ?></div>
<?php include __DIR__.'/partials/history_controls.php'; ?>
<noscript><p class="notice">Enable JavaScript to explore statistics, graphs, historical records, and CSV export.</p></noscript>
<section class="summary-grid" aria-label="History summary">
    <article><span>Recorded samples</span><strong id="sample-count">—</strong></article>
    <article><span>Measurements</span><strong>26</strong></article>
    <article><span>First sample (UTC)</span><strong class="date-value" id="first-sample">—</strong></article>
    <article><span>Latest sample (UTC)</span><strong class="date-value" id="latest-sample">—</strong></article>
</section>
<div class="section-heading"><h2>Explore a measurement</h2>
    <div class="field inline"><label for="metric-select">Measurement</label><select id="metric-select">
        <?php foreach ($groups as $group=>$label): ?><optgroup label="<?= htmlspecialchars($label) ?>">
        <?php foreach ($metrics as $key=>$m): if ($m['group']!==$group) continue; ?><option value="<?= $key ?>"><?= htmlspecialchars($m['label'].' ('.$m['unit'].')') ?></option><?php endforeach; ?>
        </optgroup><?php endforeach; ?>
    </select></div>
</div>
<section class="grid-2">
    <article class="panel"><header class="panel-head"><h2 id="selected-trend-title">Historical trend</h2><span class="panel-tag">UTC</span></header>
        <div class="telemetry-chart large-chart" id="selected-trend" tabindex="0" aria-label="Selected measurement history"></div><p class="chart-caption" id="selected-trend-caption">Loading history…</p></article>
    <article class="panel"><header class="panel-head"><h2>Normal distribution</h2><span class="panel-tag">Fitted model</span></header>
        <div class="telemetry-chart large-chart" id="distribution-chart" tabindex="0" aria-label="Histogram and fitted normal probability density"></div>
        <div class="chart-legend"><span><i class="legend-swatch histogram-swatch"></i>Observed density</span><span><i class="legend-swatch normal-swatch"></i>Fitted normal curve</span></div>
        <p class="chart-caption" id="distribution-caption">Loading history…</p></article>
</section>
<p class="method-note">The histogram and fitted curve use every numeric sample in the selected range. σ is the sample standard deviation. A fitted curve does not establish that the data are normally distributed; cumulative counters and changing scenarios often are not.</p>
<section class="panel readings-panel">
    <header class="panel-head"><h2>All measurement statistics</h2><span class="panel-tag">Selected range</span></header>
    <div class="table-scroll"><table class="data stats-table"><caption class="sr-only">Summary statistics for all 26 measurements. Select a measurement to inspect its distribution.</caption><thead><tr><th>Measurement</th><th>Unit</th><th>Samples</th><th>Latest</th><th>Mean</th><th>Std. deviation (σ)</th><th>Minimum</th><th>Maximum</th></tr></thead><tbody id="statistics-rows"></tbody></table></div>
</section>
<div class="section-heading"><h2>All measurement histories</h2><div class="field inline"><label for="graph-group">Show</label><select id="graph-group"><option value="all">All 26 measurements</option><?php foreach ($groups as $key=>$label): ?><option value="<?= $key ?>"><?= htmlspecialchars($label) ?></option><?php endforeach; ?></select></div></div>
<section class="chart-grid" id="metric-charts"><?php $chartKeys=array_keys($metrics); include __DIR__.'/partials/chart_grid.php'; ?></section>
<section class="panel readings-panel" id="historical-records">
    <header class="panel-head"><h2>Historical data</h2><button type="button" class="button" id="export-history" disabled>Export all rows (CSV)</button></header>
    <p class="panel-note">All 26 measurements, timestamps, and scenarios for the selected crew member and time range. Scroll horizontally to inspect every field.</p>
    <div class="table-scroll raw-history" tabindex="0" aria-label="Historical measurements table"><table class="data"><thead><tr><th>Recorded at (UTC)</th><th>Scenario</th><?php foreach ($metrics as $m): ?><th><?= htmlspecialchars($m['label']) ?><small><?= htmlspecialchars($m['unit']) ?></small></th><?php endforeach; ?></tr></thead><tbody id="history-rows"></tbody></table></div>
    <div class="pagination"><button type="button" class="button secondary" id="history-prev">Previous</button><span id="history-page" role="status">No records</span><button type="button" class="button secondary" id="history-next">Next</button><label><input type="checkbox" id="follow-latest" checked> Follow latest</label></div>
</section>
<?php include __DIR__.'/footer.php'; ?>
