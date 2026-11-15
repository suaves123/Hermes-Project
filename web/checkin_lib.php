<?php
// Crew health check-ins: validation, assessment against the personal baseline, storage access,
// and the text handed to mission alerts and the AI assistant.
// Storage goes through hermesApiRequest(), so built-in mode writes storage/checkins/checkins.jsonl
// and API mode uses the Python server's "checkins" table.
require_once __DIR__ . '/telemetry_client.php';

const CK_SLIDERS = ['energy_level' => 'Energy', 'stress_tension' => 'Stress', 'crew_cohesion' => 'Crew sync', 'sleep_quality' => 'Sleep quality'];
const CK_SYMPTOMS = ['none' => 'None', 'headache' => 'Headache', 'eye_pressure' => 'Eye pressure',
    'flashes_or_floaters' => 'Flashes or floaters', 'double_vision' => 'Double vision'];
// Screening limits. Change them here; the check-in page reads its copy from the server response.
const CK_LIMITS = [
    'pvt_amber_pct' => 15,   // reaction time slower than baseline by this % -> AMBER
    'pvt_red_pct' => 30,     // ... by this % -> RED
    'lapses_amber' => 2,     // reactions over 500 ms in one test -> AMBER
    'slider_low' => 3,       // energy, crew sync or sleep at or below this -> AMBER
    'stress_high' => 8,      // stress at or above this -> AMBER
    'amsler_new' => 1,       // new distorted grid squares against baseline -> AMBER
    'acuity_drop' => 0.2,    // logMAR increase against baseline -> RED
    'alert_hours' => 36,     // a check-in older than this no longer raises mission alerts
];
const CK_RANK = ['NOMINAL' => 0, 'AMBER_REVIEW' => 1, 'RED_ALERT' => 2];

function ckFail(string $message): void { throw new InvalidArgumentException($message); }
function ckInt($value, int $lo, int $hi, string $label): int {
    if (!is_numeric($value) || (float)$value != (int)$value || $value < $lo || $value > $hi) ckFail("$label must be a whole number from $lo to $hi.");
    return (int)$value;
}
function ckCells($value, string $label): array {
    if ($value === null) return [];
    if (!is_array($value) || count($value) > 400) ckFail("$label must be a list of grid squares.");
    $out = [];
    foreach ($value as $cell) {
        if (!is_string($cell) || !preg_match('/^(\d{1,2}),(\d{1,2})$/', $cell, $m) || $m[1] > 19 || $m[2] > 19) ckFail("$label contains an invalid grid square.");
        $out[(int)$m[1] . ',' . (int)$m[2]] = true;
    }
    $out = array_map('strval', array_keys($out));
    sort($out, SORT_NATURAL);
    return $out;
}
function ckMissionDay(int $time): int {
    $start = strtotime(HERMES_MISSION_START . ' 00:00:00 UTC');
    return max(1, (int)floor(($time - ($start ?: $time)) / 86400) + 1);
}
function ckWellbeing(array $s): int {
    return (int)round(($s['energy_level'] + (11 - $s['stress_tension']) + $s['crew_cohesion'] + $s['sleep_quality'] - 4) / 36 * 100);
}

// Turns the request body into a stored record (without the assessment). Throws InvalidArgumentException.
function hermesCheckinNormalize(array $in, array $crewIds, int $now): array {
    $astro = ckInt($in['astronaut_id'] ?? null, 1, 9999, 'astronaut_id');
    if (!in_array($astro, $crewIds, true)) ckFail('Unknown crew member.');
    $demo = ($in['demo'] ?? false) === true;
    $time = $now;
    if ($demo && is_string($in['timestamp_utc'] ?? null)) {
        $parsed = strtotime($in['timestamp_utc']);
        if ($parsed === false || $parsed > $now + 300 || $parsed < $now - 90 * 86400) ckFail('Invalid sample timestamp.');
        $time = $parsed;
    }
    $psych = is_array($in['psych_data'] ?? null) ? $in['psych_data'] : [];
    $sliders = [];
    foreach (CK_SLIDERS as $key => $label) $sliders[$key] = ckInt($psych['sliders'][$key] ?? null, 1, 10, $label);
    $pvt = null;
    if (is_array($psych['pvt'] ?? null)) {
        $trials = $psych['pvt']['trials'] ?? null;
        if (!is_array($trials) || count($trials) < 3 || count($trials) > 20) ckFail('The reaction test needs 3 to 20 trials.');
        $rts = [];
        foreach ($trials as $rt) {
            if (!is_numeric($rt) || $rt < 100 || $rt > 10000) ckFail('Invalid reaction time.');
            $rts[] = round((float)$rt, 1);
        }
        $sorted = $rts; sort($sorted); $n = count($sorted);
        $pvt = [
            'mean_rt_ms' => round(array_sum($rts) / $n, 1),
            'median_rt_ms' => round($n % 2 ? $sorted[intdiv($n, 2)] : ($sorted[$n / 2 - 1] + $sorted[$n / 2]) / 2, 1),
            'fastest_rt_ms' => $sorted[0], 'slowest_rt_ms' => $sorted[$n - 1],
            'false_starts' => ckInt($psych['pvt']['false_starts'] ?? 0, 0, 99, 'false_starts'),
            'lapses' => count(array_filter($rts, fn($x) => $x > 500)),
            'trials' => $rts,
        ];
    }
    $ocular = is_array($in['ocular_data'] ?? null) ? $in['ocular_data'] : [];
    $eyes = [];
    foreach (['left_eye', 'right_eye'] as $eye) {
        $e = is_array($ocular[$eye] ?? null) ? $ocular[$eye] : [];
        $cells = ckCells($e['amsler_distorted_cells'] ?? [], 'amsler_distorted_cells');
        $blur = array_values(array_intersect(ckCells($e['blur_or_scotoma_cells'] ?? [], 'blur_or_scotoma_cells'), $cells));
        $acuity = $e['acuity_logmar'] ?? null;
        if ($acuity !== null && (!is_numeric($acuity) || $acuity < -0.3 || $acuity > 1.3)) ckFail('acuity_logmar must be between -0.3 and 1.3.');
        $eyes[$eye] = ['amsler_distorted_cells' => $cells, 'blur_or_scotoma_cells' => $blur,
            'acuity_logmar' => $acuity === null ? null : round((float)$acuity, 1)];
    }
    $symptoms = [];
    foreach (is_array($ocular['symptoms'] ?? null) ? $ocular['symptoms'] : [] as $s) {
        if (!is_string($s) || !isset(CK_SYMPTOMS[$s])) ckFail('Unknown eye symptom.');
        if ($s !== 'none') $symptoms[$s] = true;
    }
    return [
        'id' => bin2hex(random_bytes(8)), 'astronaut_id' => $astro, 'mission_day' => ckMissionDay($time),
        'timestamp_utc' => gmdate('Y-m-d\TH:i:s\Z', $time), 'demo' => $demo, 'is_baseline' => false,
        'psych_data' => ['sliders' => $sliders, 'wellbeing_index' => ckWellbeing($sliders), 'pvt' => $pvt, 'audio_file' => null],
        'ocular_data' => ['left_eye' => $eyes['left_eye'], 'right_eye' => $eyes['right_eye'],
            'symptoms' => $symptoms ? array_keys($symptoms) : ['none'],
            'acuity_calibrated' => ($ocular['acuity_calibrated'] ?? false) === true, 'viewing_distance_cm' => 40],
    ];
}

// Compares a record with the crew member's baseline record (null when it is itself the baseline).
function hermesCheckinAssess(array $r, ?array $base): array {
    $L = CK_LIMITS;
    $mental = ['status' => 'NOMINAL', 'reasons' => []];
    $ocular = ['status' => 'NOMINAL', 'reasons' => []];
    $raise = function (array &$domain, string $status, string $reason): void {
        if (CK_RANK[$status] > CK_RANK[$domain['status']]) $domain['status'] = $status;
        $domain['reasons'][] = $reason;
    };
    $deltas = ['pvt_pct' => null, 'acuity_left' => null, 'acuity_right' => null, 'new_cells_left' => null, 'new_cells_right' => null];

    $s = $r['psych_data']['sliders'];
    if ($s['stress_tension'] >= $L['stress_high']) $raise($mental, 'AMBER_REVIEW', "High self-reported stress ({$s['stress_tension']}/10).");
    foreach (['energy_level' => 'energy', 'crew_cohesion' => 'crew sync', 'sleep_quality' => 'sleep quality'] as $key => $label) {
        if ($s[$key] <= $L['slider_low']) $raise($mental, 'AMBER_REVIEW', 'Low self-reported ' . $label . " ({$s[$key]}/10).");
    }
    $pvt = $r['psych_data']['pvt'];
    if ($pvt) {
        if ($pvt['lapses'] >= $L['lapses_amber']) $raise($mental, 'AMBER_REVIEW', "{$pvt['lapses']} slow reactions over 500 ms in the reaction test.");
        $basePvt = $base['psych_data']['pvt']['mean_rt_ms'] ?? null;
        if ($basePvt) {
            $pct = round(($pvt['mean_rt_ms'] - $basePvt) / $basePvt * 100, 1);
            $deltas['pvt_pct'] = $pct;
            if ($pct >= $L['pvt_red_pct']) $raise($mental, 'RED_ALERT', 'Reaction time is ' . round($pct) . "% slower than baseline (limit {$L['pvt_red_pct']}%).");
            elseif ($pct >= $L['pvt_amber_pct']) $raise($mental, 'AMBER_REVIEW', 'Reaction time is ' . round($pct) . "% slower than baseline (limit {$L['pvt_amber_pct']}%).");
        }
    }

    $symptoms = $r['ocular_data']['symptoms'];
    $visual = array_values(array_intersect($symptoms, ['flashes_or_floaters', 'double_vision']));
    $newCells = 0;
    foreach (['left' => 'left_eye', 'right' => 'right_eye'] as $side => $eye) {
        $today = $r['ocular_data'][$eye];
        $b = $base['ocular_data'][$eye] ?? null;
        if ($b !== null) {
            $fresh = count(array_diff($today['amsler_distorted_cells'], $b['amsler_distorted_cells']));
            $deltas['new_cells_' . $side] = $fresh; $newCells += $fresh;
            if ($fresh >= $L['amsler_new']) $raise($ocular, 'AMBER_REVIEW', $fresh . ' new distorted grid square' . ($fresh === 1 ? '' : 's') . " in the $side eye.");
            if ($today['acuity_logmar'] !== null && $b['acuity_logmar'] !== null) {
                $d = round($today['acuity_logmar'] - $b['acuity_logmar'], 1);
                $deltas['acuity_' . $side] = $d;
                // logMAR rises as vision gets worse.
                if ($d >= $L['acuity_drop'] - 1e-9) $raise($ocular, 'RED_ALERT', 'Sharpness dropped by ' . number_format($d, 1) . " logMAR in the $side eye (limit {$L['acuity_drop']}).");
            }
        }
    }
    if ($visual) {
        $names = strtolower(implode(' and ', array_map(fn($k) => CK_SYMPTOMS[$k], $visual)));
        if ($newCells >= $L['amsler_new']) $raise($ocular, 'RED_ALERT', "New grid distortion together with $names.");
        else $raise($ocular, 'AMBER_REVIEW', 'Reported ' . $names . '.');
    }
    $flag = CK_RANK[$mental['status']] >= CK_RANK[$ocular['status']] ? $mental['status'] : $ocular['status'];
    return ['flag_status' => $flag, 'mental' => $mental, 'ocular' => $ocular, 'baseline_id' => $base['id'] ?? null, 'deltas' => $deltas];
}

function hermesCheckinList(array $query = []): ?array {
    $response = hermesApiGet('/api/checkins' . ($query ? '?' . http_build_query($query) : ''));
    return $response === null ? null : hermesRows($response['checkins'] ?? null);
}
// Latest check-in of every crew member, keyed by astronaut ID. Null when the store is unreachable.
function hermesCheckinLatest(): ?array {
    $rows = hermesCheckinList(['latest' => 1]);
    if ($rows === null) return null;
    $out = [];
    foreach ($rows as $row) {
        $id = (int)($row['astronaut_id'] ?? 0);
        if ($id > 0 && isset($row['assessment'], $row['timestamp_utc'])) $out[$id] = $row;
    }
    return $out;
}
// Mission alerts raised by recent check-ins: one entry per flagged domain.
function hermesCheckinAlerts(array $latest, int $now): array {
    $out = [];
    foreach ($latest as $id => $r) {
        $time = strtotime((string)$r['timestamp_utc']);
        if ($time === false || $now - $time > CK_LIMITS['alert_hours'] * 3600) continue;
        foreach (['mental' => 'Check-in · Mental', 'ocular' => 'Check-in · Ocular'] as $domain => $category) {
            $d = $r['assessment'][$domain] ?? null;
            if (!is_array($d) || ($d['status'] ?? 'NOMINAL') === 'NOMINAL') continue;
            $reasons = array_filter(is_array($d['reasons'] ?? null) ? $d['reasons'] : [], 'is_string');
            $out[] = ['astronaut_id' => (int)$id, 'type' => $d['status'] === 'RED_ALERT' ? 'crit' : 'warn', 'category' => $category,
                'message' => implode(' ', $reasons) . ' (check-in ' . gmdate('M j H:i', $time) . ' UTC)'];
        }
    }
    return $out;
}
// Plain-text description of one check-in for the AI assistant.
function hermesCheckinAiText(array $r): string {
    $a = $r['assessment'];
    $s = $r['psych_data']['sliders'] ?? [];
    $pvt = $r['psych_data']['pvt'] ?? null;
    $label = fn($status) => ucwords(strtolower(str_replace('_', ' ', (string)$status)));
    $lines = ['Latest health check-in: ' . str_replace('T', ' ', rtrim((string)$r['timestamp_utc'], 'Z')) . ' UTC, mission day ' . (int)($r['mission_day'] ?? 0)
        . ', overall ' . $label($a['flag_status'] ?? 'NOMINAL') . (!empty($r['is_baseline']) ? ' (this check-in is the personal baseline)' : '') . '.'];
    $mental = 'Mental check-in (' . $label($a['mental']['status'] ?? 'NOMINAL') . '): wellbeing index ' . (int)($r['psych_data']['wellbeing_index'] ?? 0) . '/100';
    foreach (CK_SLIDERS as $key => $name) if (isset($s[$key])) $mental .= ', ' . strtolower($name) . ' ' . $s[$key] . '/10';
    if ($pvt) {
        $mental .= ', mean reaction time ' . round($pvt['mean_rt_ms']) . ' ms';
        if (($a['deltas']['pvt_pct'] ?? null) !== null) $mental .= ' (' . sprintf('%+d', round($a['deltas']['pvt_pct'])) . '% against baseline)';
        $mental .= ', ' . $pvt['false_starts'] . ' false starts, ' . $pvt['lapses'] . ' lapses';
    } else $mental .= ', reaction test not done';
    $lines[] = $mental . '.';
    $ocular = 'Ocular check-in (' . $label($a['ocular']['status'] ?? 'NOMINAL') . '):';
    foreach (['left' => 'left_eye', 'right' => 'right_eye'] as $side => $eye) {
        $e = $r['ocular_data'][$eye] ?? [];
        $ocular .= " $side eye sharpness " . (($e['acuity_logmar'] ?? null) === null ? 'not tested' : number_format($e['acuity_logmar'], 1) . ' logMAR')
            . ', ' . count($e['amsler_distorted_cells'] ?? []) . ' distorted grid squares;';
    }
    $ocular .= ' symptoms: ' . strtolower(implode(', ', array_map(fn($k) => CK_SYMPTOMS[$k] ?? $k, $r['ocular_data']['symptoms'] ?? ['none']))) . '.';
    $lines[] = $ocular;
    $reasons = array_merge($a['mental']['reasons'] ?? [], $a['ocular']['reasons'] ?? []);
    if ($reasons) $lines[] = 'Check-in findings: ' . implode(' ', $reasons);
    return implode("\n", $lines);
}

/* ---------- Built-in storage (used by hermesLocalRequest) ---------- */
function ckLocalFile(): string { return HERMES_SHARED_DIR . '/checkins/checkins.jsonl'; }
function ckLocalRead(): array {
    $file = ckLocalFile();
    if (!is_file($file)) return [];
    $fh = @fopen($file, 'rb');
    if (!$fh) throw new RuntimeException('Cannot read the check-in file.');
    try {
        flock($fh, LOCK_SH);
        $rows = [];
        while (($line = fgets($fh)) !== false) {
            $row = json_decode($line, true);
            if (is_array($row) && isset($row['id'], $row['astronaut_id'], $row['timestamp_utc'])) $rows[] = $row;
        }
        return $rows;
    } finally { flock($fh, LOCK_UN); fclose($fh); }
}
function hermesCheckinLocalRequest(string $method, string $path, array $query, ?array $body): ?array {
    $folder = dirname(ckLocalFile());
    if ($method === 'GET' && $path === '/api/checkins') {
        $rows = ckLocalRead();
        usort($rows, fn($a, $b) => strcmp((string)$b['timestamp_utc'], (string)$a['timestamp_utc']));
        if (isset($query['astronaut_id'])) $rows = array_values(array_filter($rows, fn($r) => (int)$r['astronaut_id'] === (int)$query['astronaut_id']));
        if (!empty($query['latest'])) {
            $seen = [];
            $rows = array_values(array_filter($rows, function ($r) use (&$seen) {
                if (isset($seen[$r['astronaut_id']])) return false;
                return $seen[$r['astronaut_id']] = true;
            }));
        }
        return ['checkins' => array_slice($rows, 0, max(1, min(1000, (int)($query['limit'] ?? 500))))];
    }
    if ($method !== 'POST') return null;
    if (!is_dir($folder) && !@mkdir($folder, 0770, true) && !is_dir($folder)) throw new RuntimeException('The check-in folder is not writable.');
    $fh = @fopen(ckLocalFile(), 'ab');
    if (!$fh) throw new RuntimeException('Cannot open the check-in file.');
    try {
        if (!flock($fh, LOCK_EX)) throw new RuntimeException('Cannot lock the check-in file.');
        if ($path === '/api/checkins/clear') { ftruncate($fh, 0); return ['status' => 'ok']; }
        if ($path === '/api/checkins' && is_array($body) && isset($body['id'], $body['astronaut_id'], $body['timestamp_utc'])) {
            fwrite($fh, json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE) . "\n"); fflush($fh);
            return ['status' => 'ok', 'id' => $body['id']];
        }
        return null;
    } finally { flock($fh, LOCK_UN); fclose($fh); }
}
