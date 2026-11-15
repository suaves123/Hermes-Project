<?php if (!$rows): ?>
    <tr><td colspan="4" class="muted"><?= htmlspecialchars($apiOnline ? 'No telemetry recorded for this crew member yet.' : $apiStatusMsg) ?></td></tr>
<?php endif; ?>
<?php foreach ($rows as $r): ?>
    <tr>
        <td><?= htmlspecialchars($r[0]) ?></td>
        <td class="num"><?= htmlspecialchars($r[1]) ?></td>
        <td><?= htmlspecialchars($r[2]) ?></td>
        <td><span class="chip <?= $r[3] ?>"><?= $statusText[$r[3]] ?></span></td>
    </tr>
<?php endforeach; ?>
