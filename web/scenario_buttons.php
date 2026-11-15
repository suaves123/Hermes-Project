<form method="post" action="?astro=<?= $astroId ?><?= ($dashboardView??'')!==''?'&amp;view='.htmlspecialchars($dashboardView):'' ?>" class="scenario-form" id="scenario-form" title="Simulation scenario applies to the selected crew member only">
    <?php include __DIR__.'/partials/scenario_buttons.php'; ?>
</form>
<span class="scenario-msg<?= $simError?' error':'' ?>" id="scenario-msg" aria-live="polite"><?php
if ($simError) echo 'Could not change the scenario.';
elseif ($simSent!==null && $scenario!==$simSent) echo 'Scenario requested. Waiting for the next reading…';
?></span>
