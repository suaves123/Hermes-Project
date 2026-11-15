<?php
$current=basename($_SERVER['PHP_SELF']);
$links=['index.php'=>'Dashboard','cardiovascular.php'=>'Cardiovascular','musculoskeletal.php'=>'Musculoskeletal',
    'immune_stress.php'=>'Immune & stress','energy_sleep.php'=>'Energy & sleep','statistics.php'=>'Statistics','health_checkin.php'=>'Check-in'];
?>
<header class="topbar">
    <a class="brand" href="index.php?astro=<?= $astroId ?>" aria-label="Hermes dashboard">
        <img src="hermes.svg" width="38" height="38" alt="">
        <span><strong>HERMES</strong><small>Crew Health Monitoring</small></span>
    </a>
    <input type="checkbox" id="nav-toggle" class="nav-toggle" aria-label="Open navigation">
    <label for="nav-toggle" class="nav-burger"><span></span><span></span><span></span></label>
    <nav class="nav" aria-label="Main navigation">
        <?php foreach ($links as $file=>$label): ?>
        <a href="<?= $file ?>?astro=<?= $astroId ?>" class="<?= $current===$file?'active':'' ?>" <?= $current===$file?'aria-current="page"':'' ?>><?= htmlspecialchars($label) ?></a>
        <?php endforeach; ?>
    </nav>
    <div class="status-pill <?= $apiOnline?'':'offline' ?>" id="api-pill" title="Telemetry connection status">
        <span class="pulse"></span><span id="api-state"><?= $apiOnline?'ONLINE':'OFFLINE' ?></span>
    </div>
</header>
