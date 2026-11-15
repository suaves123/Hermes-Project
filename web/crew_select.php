<?php if ($astronauts): ?>
<form method="get" class="crew-form" id="crew-form" aria-label="Select crew member">
    <?php foreach ($astronauts as $member):
        $portrait = 'portraits/'.$member['id'].'.jpg'; ?>
        <button type="submit" class="crew-button" name="astro" value="<?= $member['id'] ?>" aria-pressed="<?= $member['id']===$astroId?'true':'false' ?>">
            <?php if (is_file(__DIR__.'/'.$portrait)): ?>
                <img class="crew-portrait" src="<?= $portrait ?>" width="40" height="40" alt="">
            <?php else: ?>
                <span class="crew-portrait" aria-hidden="true"><?= sprintf('%02d', $member['id']) ?></span>
            <?php endif; ?>
            <span><?= htmlspecialchars($member['name']) ?></span>
        </button>
    <?php endforeach; ?>
    <?php if (($dashboardView??'')!==''): ?><input type="hidden" name="view" value="<?= htmlspecialchars($dashboardView) ?>"><?php endif; ?>
</form>
<?php endif; ?>
