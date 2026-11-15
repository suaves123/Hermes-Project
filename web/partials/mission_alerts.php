<?php
$levels = ['crit'=>'Critical', 'warn'=>'Warning', 'info'=>'Information'];
if (!$crewAlertsAvailable) $alertStatus = 'Alert feed unavailable';
elseif (!$crewRecords && !$missionAlerts) $alertStatus = 'Waiting for crew telemetry';
elseif (!$missionAlerts) $alertStatus = 'No active alerts';
else $alertStatus = count($missionAlerts).' active';
?>
<div class="mission-alerts-heading">
    <h2 id="mission-alerts-title">Mission alerts</h2>
    <p class="mission-alerts-status" role="status"><?= htmlspecialchars($alertStatus) ?></p>
</div>
<?php if ($missionAlerts): ?>
    <ul class="mission-alerts-list">
        <?php foreach ($missionAlerts as $alert): ?>
            <li class="mission-alert <?= $alert['type'] ?>">
                <div class="mission-alert-heading">
                    <strong><?= htmlspecialchars($alert['crew']) ?></strong>
                    <span><?= $levels[$alert['type']] ?></span>
                </div>
                <p><b><?= htmlspecialchars($alert['category']) ?></b> · <?= htmlspecialchars($alert['message']) ?></p>
            </li>
        <?php endforeach; ?>
    </ul>
<?php endif; ?>
