<?php foreach ($chartKeys as $key): $metric=$metrics[$key]; ?>
<article class="panel chart-card" data-group="<?= $metric['group'] ?>">
    <header class="panel-head"><h2><?= htmlspecialchars($metric['label']) ?></h2><span class="panel-tag"><?= htmlspecialchars($metric['unit']) ?></span></header>
    <div class="chart-current"><strong data-current="<?= $key ?>">—</strong><span><?= htmlspecialchars($metric['unit']) ?></span></div>
    <div class="telemetry-chart" data-chart="<?= $key ?>" tabindex="0" aria-label="<?= htmlspecialchars($metric['label']) ?> history"><p class="chart-empty">Loading recorded history…</p></div>
    <p class="chart-caption" data-caption="<?= $key ?>">Waiting for measurements.</p>
</article>
<?php endforeach; ?>
