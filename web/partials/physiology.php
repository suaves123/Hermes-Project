<?php foreach ($physiology as $m): ?>
    <div class="metric <?= $m['status'] ?>">
        <div class="metric-top">
            <span class="metric-label"><?= htmlspecialchars($m['label']) ?></span>
            <span class="chip <?= $m['status'] ?>"><?= $statusText[$m['status']] ?></span>
        </div>
        <div class="metric-value"><?= htmlspecialchars(showVal($m['value'])) ?> <small><?= $m['unit'] ?></small></div>
        <?php if (isset($m['min']) && is_numeric($m['value'])):
            $pct = max(0, min(100, ($m['value'] - $m['min']) / ($m['max'] - $m['min']) * 100)); ?>
            <div class="bar"><span style="width: <?= round($pct) ?>%"></span></div>
            <div class="range"><span><?= $m['min'] ?></span><span><?= $m['max'] ?></span></div>
        <?php endif; ?>
    </div>
<?php endforeach; ?>
