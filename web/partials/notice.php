<?php if (!$t): ?>
<p class="notice"><?= htmlspecialchars($apiOnline ? 'Connected. Waiting for telemetry for this crew member.' : $apiStatusMsg) ?></p>
<?php endif; ?>
