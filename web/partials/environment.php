<?php foreach ($environment as $e): ?>
    <div class="env-item">
        <span class="metric-label"><?= htmlspecialchars($e['label']) ?></span>
        <span class="env-value"><?= htmlspecialchars(showVal($e['value'])) ?><small> <?= $e['unit'] ?></small></span>
    </div>
<?php endforeach; ?>
