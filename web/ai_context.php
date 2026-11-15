<?php
// Helpers shared by the AI endpoints (ollama.php and ask.php). Requires api_client.php first.
function hermesAiInstructions(): string {
    return "You are the crew health analyst for Hermes, a SIMULATED spaceflight dashboard. Write professionally and concisely in "
        . HERMES_AI_LANGUAGE . ". Use plain text and the supplied telemetry as the source of facts. "
        . "For an assessment, state the relevant current measurements with units and cite available recent statistics or trends. "
        . "Acknowledge sparse, stale, or missing data. Historical counts describe samples, without establishing consecutive events. "
        . "When the evidence supports one, offer a tentative diagnostic hypothesis for the simulation and explain what supports it. "
        . "A scenario label alone is not evidence. Treat mental and ocular check-ins as screening findings, distinguish sample records, and relate changes to the astronaut’s own baseline when available. Do not invent symptoms, sensor values, thresholds, trends, diagnoses, or causal links. "
        . "Offer specific operational checks, such as repeating a suspect measurement or comparing related sensors, when appropriate. "
        . "For sustained critical alerts, recommend notifying mission medical staff in the simulation. "
        . "Do not prescribe medications or treatment. Do not present hypotheses as confirmed diagnoses.\n";
}

function hermesAiHistory(int $id, string $recordedAt, array $metrics): string {
    $end = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $recordedAt, new DateTimeZone('UTC'));
    if (!$end || $end->format('Y-m-d H:i:s') !== $recordedAt) return 'Recent statistics unavailable.';
    $params = ['astronaut_id' => $id, 'start' => $end->modify('-5 minutes')->format('Y-m-d H:i:s'),
        'end' => $recordedAt, 'limit' => 300];
    $history = hermesApiGet('/api/history?' . http_build_query($params));
    $rows = hermesRows($history['records'] ?? null);
    if (count($rows) < 2) return 'Recent trend unavailable (fewer than two historical readings or history unavailable).';
    usort($rows, fn($a, $b) => strcmp($a['recorded_at'], $b['recorded_at']) ?: $a['id'] <=> $b['id']);
    $lastRow = $rows[count($rows) - 1];
    $metricsToSummarize = ['heart_rate', 'spo2', 'respiratory_rate', 'body_temp', 'hrv_rmssd',
        'stress_level', 'hydration', 'cabin_o2', 'radiation'];
    $lines = [];
    foreach ($metricsToSummarize as $key) {
        $values = array_values(array_filter(array_column($rows, $key),
            fn($v) => is_numeric($v) && is_finite((float)$v)));
        $count = count($values);
        if ($count < 2) continue;
        $metric = $metrics[$key];
        $mean = round(array_sum($values) / $count, max(1, $metric['digits']));
        $first = $values[0];
        $last = $values[$count - 1];
        $line = sprintf('%s (%s): %s to %s; mean %s; range %s–%s; n=%d',
            $metric['label'], $metric['unit'], $first, $last, $mean, min($values), max($values), $count);
        if ($metric['range']) {
            $statuses = array_count_values(array_map(fn($v) => metricStatus($metric, $v), $values));
            $attention = $statuses['warn'] ?? 0;
            $critical = $statuses['crit'] ?? 0;
            if ($attention || $critical) $line .= "; attention=$attention, critical=$critical";
        }
        $lines[] = $line;
    }
    if (!$lines) return 'Recent statistics unavailable (insufficient numeric readings).';
    return sprintf('Recent statistics, %s through %s UTC (%d records from the latest five-minute window, up to 300):',
        $rows[0]['recorded_at'], $lastRow['recorded_at'], count($rows)) . "\n" . implode("\n", $lines);
}

function hermesAiContext(array $crew, array $records, array $metrics, array $statusText, array $alertsByCrew, bool $alertsAvailable, ?array $checkins = null): string {
    $members = [];
    foreach ($crew as $member) {
        $id = $member['id'];
        $name = sprintf('Astronaut %02d — %s', $id, $member['name']);
        $checkin = $checkins[$id] ?? null;
        $checkinText = $checkin
            ? (!empty($checkin['demo']) ? "Sample screening record.\n" : "Crew screening record.\n") . hermesCheckinAiText($checkin)
            : 'Latest health check-in: none recorded.';
        $record = $records[$id] ?? null;
        if ($record === null) {
            $members[] = "$name\nTelemetry unavailable." . "\n" . $checkinText;
            continue;
        }
        $scenario = hermesText($record['scenario'] ?? null, 'Unknown');
        $label = HERMES_SCENARIOS[hermesScenarioCode($scenario)]['label'] ?? $scenario;
        $time = hermesText($record['recorded_at'] ?? null, 'Unknown');
        $lines = [];
        foreach ($metrics as $key => $metric) {
            $value = $record[$key] ?? null;
            if ($value === null) continue;
            $status = $metric['range'] ? ' (' . $statusText[metricStatus($metric, $value)] . ')' : '';
            $lines[] = $metric['label'] . ': ' . $value . ' ' . $metric['unit'] . $status;
        }
        $alerts = array_map(
            fn($a) => $a['type'].' / '.$a['category'].': '.$a['message'],
            $alertsByCrew[$id] ?? []
        );
        $alertText = !$alertsAvailable ? 'Alert feed unavailable.' : ($alerts ? implode("\n", $alerts) : 'No active alerts.');
        $members[] = "$name\nScenario: $label\nRecorded at (UTC): $time\nReadings:\n" . implode("\n", $lines)
            . "\nRule-based alerts:\n" . $alertText
            . "\n" . $checkinText . "\n" . hermesAiHistory($id, $time, $metrics);
    }
    return "Current UTC time: " . gmdate('Y-m-d H:i:s') . "\nLatest telemetry, statistics, and self-administered health check-ins:\n\n" . implode("\n\n", $members) . "\n";
}
// Starts worker/ollama_worker.php in the background (the PHP built-in server must never wait for Ollama).
function hermesAiSpawn(string $jobFile): bool {
    $worker = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'worker' . DIRECTORY_SEPARATOR . 'ollama_worker.php';
    $php = PHP_BINARY;
    if (!is_file($worker) || $php === '' || !is_file($php)) return false;
    if (DIRECTORY_SEPARATOR === '\\') {
        $h = @popen('start /B "" "' . $php . '" "' . $worker . '" "' . $jobFile . '" >NUL 2>&1', 'r');
        if ($h === false) return false;
        pclose($h);
        return true;
    }
    @exec(escapeshellarg($php) . ' ' . escapeshellarg($worker) . ' ' . escapeshellarg($jobFile) . ' > /dev/null 2>&1 &');
    return true;
}
// Trim, drop control characters and cut to $max characters (UTF-8 safe without mbstring).
function hermesAiClean(string $s, int $max): string {
    $s = trim((string)preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $s));
    return preg_match('/^.{0,' . $max . '}/su', $s, $m) ? $m[0] : substr($s, 0, $max);
}
