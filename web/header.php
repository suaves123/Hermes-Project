<?php $pageTitle=$pageTitle??'Dashboard'; ?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Hermes crew health telemetry, live trends, and mission statistics.">
    <title><?= htmlspecialchars($pageTitle) ?> · Hermes</title>
    <link rel="icon" type="image/svg+xml" href="hermes.svg">
    <link rel="stylesheet" href="style.css">
    <script src="stats.js" defer></script>
    <script src="charts.js" defer></script>
    <script src="live.js" defer></script>
    <script src="general.js" defer></script>
    <script src="checkin.js" defer></script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<?php include __DIR__.'/menu.php'; ?>
<main id="main" class="container" data-live-section="<?= htmlspecialchars($liveSection??'index') ?>" data-live-astro="<?= (int)($astroId??1) ?>">
<div class="mission-controls">
    <div id="crew-selector"><?php include __DIR__.'/crew_select.php'; ?></div>
    <div id="mission-scenario" <?= ($liveSection??'index')==='checkin'?'hidden':'' ?>><?php include __DIR__.'/scenario_buttons.php'; ?></div>
</div>
<section id="mission-alerts" class="mission-alerts" aria-labelledby="mission-alerts-title">
    <?php include __DIR__.'/partials/mission_alerts.php'; ?>
</section>
<p id="navigation-status" class="notice" role="status" hidden></p>
<div id="page-content">
