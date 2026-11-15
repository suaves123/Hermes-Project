<?php foreach ($biometric as $m): ?>
    <div class="tile <?= $m['status'] ?>">
        <span class="metric-label"><?= htmlspecialchars($m['label']) ?></span>
        <div class="metric-value"><?= is_numeric($m['value']) && $m['value'] >= 1000 ? number_format($m['value'], 0, '.', ',') : htmlspecialchars(showVal($m['value'])) ?></div>
        <div class="tile-foot">
            <small><?= $m['unit'] ?></small>
            <span class="chip <?= $m['status'] ?>"><?= $statusText[$m['status']] ?></span>
        </div>
    </div>
<?php endforeach; ?>
