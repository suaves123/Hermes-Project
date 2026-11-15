<span class="scenario-label">Scenario</span>
<?php foreach ($scenarios as $code => $sc): $code = (string)$code; ?>
    <button type="submit" name="scenario" value="<?= htmlspecialchars($code) ?>"
            class="chip <?= $sc['chip'] ?><?= $scenario === $code ? ' active' : '' ?>"
            aria-pressed="<?= $scenario === $code ? 'true' : 'false' ?>"
            <?= $apiOnline ? '' : 'disabled' ?>><?= htmlspecialchars($sc['label']) ?></button>
<?php endforeach; ?>
