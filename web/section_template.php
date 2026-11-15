<?php
$liveSection=$section;
require_once __DIR__.'/api_client.php';
$rows=$subpageRows[$section]??[];
$chartKeys=array_keys(array_filter($metrics,fn($m)=>$m['group']===$section));
include __DIR__.'/header.php';
?>
<section class="page-head">
    <div><p class="eyebrow">CREW TELEMETRY</p><h1><?= htmlspecialchars($pageTitle) ?></h1><p class="muted"><?= htmlspecialchars($subtitle) ?></p><p class="muted" id="crew-label"><?= htmlspecialchars($crew) ?></p></div>
</section>
<div class="telemetry-meta"><span class="source-badge"><?= htmlspecialchars($sourceLabel) ?></span><span id="last-updated">Waiting for a reading…</span></div>
<div id="notice-slot"><?php include __DIR__.'/partials/notice.php'; ?></div>
<?php include __DIR__.'/partials/history_controls.php'; ?>
<noscript><p class="notice">Enable JavaScript to display historical charts and live updates.</p></noscript>
<section class="chart-grid"><?php include __DIR__.'/partials/chart_grid.php'; ?></section>
<article class="panel readings-panel">
    <header class="panel-head"><h2>Current readings</h2><span class="panel-tag">Sensors</span></header>
    <div class="table-scroll"><table class="data"><thead><tr><th>Measurement</th><th>Value</th><th>Unit</th><th>Status</th></tr></thead><tbody id="live-readings"><?php include __DIR__.'/partials/readings.php'; ?></tbody></table></div>
</article>
<?php include __DIR__.'/footer.php'; ?>
