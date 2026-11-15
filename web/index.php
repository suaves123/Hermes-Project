<?php
$pageTitle='Dashboard'; $liveSection='index';
require __DIR__.'/api_client.php';
$view=$dashboardView!==''?$dashboardView:'general';
include __DIR__.'/header.php';
?>
<section class="page-head">
    <div><p class="eyebrow">MISSION CONTROL</p><h1>Crew health dashboard</h1><p class="muted" id="crew-label"><?= htmlspecialchars($crew) ?></p></div>
</section>
<div class="control-bar">
    <div class="view-switch" role="group" aria-label="Dashboard view">
        <button type="button" data-view="general" aria-pressed="<?= $view==='general'?'true':'false' ?>">General view</button>
        <button type="button" data-view="data" aria-pressed="<?= $view==='data'?'true':'false' ?>">Data view</button>
        <button type="button" data-view="graphs" aria-pressed="<?= $view==='graphs'?'true':'false' ?>">Graph view</button>
    </div>
</div>
<div class="telemetry-meta"><span class="source-badge"><?= htmlspecialchars($sourceLabel) ?></span><span id="last-updated">Waiting for a reading…</span></div>
<div id="notice-slot"><?php include __DIR__.'/partials/notice.php'; ?></div>
<noscript><p class="notice">Enable JavaScript for live updates, graphs, and the dashboard view switch.</p></noscript>
<section id="dashboard-general" aria-label="General crew overview" <?= $view==='general'?'':'hidden' ?>>
    <div class="general-view" id="general-view"><p class="chart-empty">Loading crew overview…</p></div>
</section>
<section class="dashboard" id="dashboard-data" <?= $view==='data'?'':'hidden' ?>>
    <article class="panel"><header class="panel-head"><span class="panel-icon phys">♥</span><h2>Physiology</h2><span class="panel-tag">Wearables</span></header>
        <div class="metric-list" id="live-physiology"><?php include __DIR__.'/partials/physiology.php'; ?></div></article>
    <article class="panel"><header class="panel-head"><span class="panel-icon bio">◉</span><h2>Biometrics</h2><span class="panel-tag">Analysis</span></header>
        <div class="tile-grid" id="live-biometric"><?php include __DIR__.'/partials/biometric.php'; ?></div></article>
    <div class="stack">
        <article class="panel"><header class="panel-head"><span class="panel-icon env">☁</span><h2>Environment</h2><span class="panel-tag">Cabin</span></header>
            <div class="env-grid" id="live-environment"><?php include __DIR__.'/partials/environment.php'; ?></div></article>
    </div>
</section>
<section id="dashboard-graphs" <?= $view==='graphs'?'':'hidden' ?>>
    <?php include __DIR__.'/partials/history_controls.php'; ?>
    <div class="section-heading"><h2>Live measurement trends</h2><div class="field inline"><label for="graph-group">Show</label><select id="graph-group"><option value="all">All 26 measurements</option><?php foreach ($groups as $key=>$label): ?><option value="<?= $key ?>"><?= htmlspecialchars($label) ?></option><?php endforeach; ?></select></div></div>
    <div class="chart-grid" id="metric-charts"><?php $chartKeys=array_keys($metrics); include __DIR__.'/partials/chart_grid.php'; ?></div>
</section>
<?php include __DIR__.'/footer.php'; ?>
