<?php
require_once __DIR__ . '/telemetry_client.php';
require_once __DIR__ . '/metrics.php';
require_once __DIR__ . '/checkin_lib.php';
function evalStatus($value, float $okMin, float $okMax, float $critMin, float $critMax): string {
    if (!is_numeric($value)) return 'warn';
    if ($value < $critMin || $value > $critMax) return 'crit';
    return $value < $okMin || $value > $okMax ? 'warn' : 'ok';
}
function showVal($value): string { return $value === null || $value === '' ? '—' : (string)$value; }
function metricStatus(array $metric, $value): string {
    if ($value === null) return 'warn';
    return $metric['range'] ? evalStatus($value, ...$metric['range']) : 'ok';
}
function hermesScenarioCode(string $name): ?string {
    foreach (HERMES_SCENARIOS as $code => $scenario) {
        if ($name === $scenario['name'] || $name === (string)$code) return (string)$code;
    }
    return null;
}
$astroId = max(1, (int)($_GET['astro'] ?? 1));
// Dashboard view kept across crew and scenario changes: general, data or graphs.
$dashboardView = in_array($_GET['view'] ?? '', ['general', 'data', 'graphs'], true) ? $_GET['view'] : '';
$scenarios = HERMES_SCENARIOS;
$statusText = ['ok'=>'Normal', 'warn'=>'Attention', 'crit'=>'Critical'];
$scenarioResult = null;
// Process scenario changes before reading telemetry, so the response reflects the change.
if (($handleScenario ?? true) && ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $isJson = strpos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== false;
    $body = $isJson ? json_decode((string)file_get_contents('php://input'), true) : $_POST;
    $code = is_array($body) ? ($body['scenario'] ?? null) : null;
    if (!is_string($code) || !isset($scenarios[$code])) {
        $scenarioResult = ['ok'=>false, 'error'=>'Invalid scenario.'];
    } else {
        $result = hermesApiRequest('POST', '/api/scenario', ['scenario'=>$code, 'astronaut_id'=>$astroId]);
        $scenarioResult = $result !== null ? ['ok'=>true,'requested'=>$code] : ['ok'=>false,'error'=>hermesErrorMessage()];
    }
    if (!$isJson) {
        $params = ['astro'=>$astroId, 'sim'=>$scenarioResult['ok'] ? 'sent_'.$code : 'error'];
        if ($dashboardView !== '') $params['view'] = $dashboardView;
        header('Location: '.basename($_SERVER['PHP_SELF']).'?'.http_build_query($params));
        exit;
    }
}
$simParam = is_string($_GET['sim'] ?? '') ? ($_GET['sim'] ?? '') : '';
$simSent = strpos($simParam, 'sent_') === 0 && isset($scenarios[substr($simParam,5)]) ? substr($simParam,5) : null;
$simError = $simParam === 'error';
$astronautsResp = hermesApiGet('/api/astronauts');
$apiOnline = $astronautsResp !== null;
$apiStatusMsg = $apiOnline ? '' : hermesErrorMessage();
$latestResp = $apiOnline ? hermesApiGet('/api/latest') : null;
if ($apiOnline && $latestResp === null) { $apiOnline=false; $apiStatusMsg=hermesErrorMessage(); }
$alertsResp = $apiOnline ? hermesApiGet('/api/alerts') : null;
$astronauts = [];
foreach (hermesRows($astronautsResp['astronauts'] ?? null) as $a) {
    $id = (int)($a['id'] ?? 0);
    if ($id > 0) $astronauts[$id] = ['id'=>$id, 'name'=>hermesText($a['name'] ?? null, 'Unnamed')];
}
$metrics = hermesMetrics();
$groups = hermesGroups();
$crewRecords = [];
foreach (hermesRows($latestResp['records'] ?? null) as $record) {
    $id = (int)($record['astronaut_id'] ?? 0);
    if ($id < 1) continue;
    foreach ($metrics as $key=>$metric) {
        $v = $record[$key] ?? null;
        $record[$key] = is_numeric($v) && is_finite((float)$v) ? 0+$v : null;
    }
    $crewRecords[$id] = $record;
    $astronauts[$id] ??= ['id'=>$id, 'name'=>"Astronaut $id"];
}
ksort($astronauts);
foreach ($astronauts as $id => $member) $astronauts[$id]['portrait'] = is_file(__DIR__ . '/portraits/' . $id . '.jpg');
$t = $crewRecords[$astroId] ?? null;
$scenario = hermesScenarioCode(hermesText($t['scenario'] ?? ''));
$crewName = $astronauts[$astroId]['name'] ?? 'Unknown';
$crew = sprintf('Astronaut %02d — %s', $astroId, $crewName);
// Latest health check-in per crew member; flagged ones join the mission alerts below.
$checkinLatest = $apiOnline ? hermesCheckinLatest() : null;
$crewScope = md5(serialize(array_map(fn($a) => [$a['name'], $crewRecords[$a['id']]['scenario'] ?? null, $checkinLatest[$a['id']]['id'] ?? null], $astronauts)));
$alertsByCrew = [];
$missionAlerts = [];
foreach (hermesRows($alertsResp['alerts'] ?? null) as $alert) {
    $id = (int)($alert['astronaut_id'] ?? 0);
    if ($id < 1) continue;
    $type = in_array($alert['alert_type'] ?? '', ['ok','warn','crit','info'], true) ? $alert['alert_type'] : 'info';
    $entry = ['type'=>$type, 'category'=>hermesText($alert['category'] ?? null, 'General'),
        'message'=>hermesText($alert['message'] ?? null, 'No message supplied.')];
    $alertsByCrew[$id][] = $entry;
    if ($type !== 'ok') $missionAlerts[] = $entry + ['crew'=>$astronauts[$id]['name'] ?? "Astronaut $id"];
}
foreach (hermesCheckinAlerts($checkinLatest ?? [], time()) as $alert) {
    $id = $alert['astronaut_id'];
    $entry = ['type'=>$alert['type'], 'category'=>$alert['category'], 'message'=>$alert['message']];
    $alertsByCrew[$id][] = $entry;
    $missionAlerts[] = $entry + ['crew'=>$astronauts[$id]['name'] ?? "Astronaut $id"];
}
$priority = ['crit'=>0, 'warn'=>1, 'info'=>2];
usort($missionAlerts, fn($a, $b) => $priority[$a['type']] <=> $priority[$b['type']]);
$crewAlertsAvailable = $alertsResp !== null;
$physiology=[]; $biometric=[]; $environment=[]; $subpageRows=[];
foreach ($groups as $key=>$label) $subpageRows[$key]=[];
foreach ($metrics as $key=>$m) {
    $value=$t[$key] ?? null;
    if ($t) $subpageRows[$m['group']][] = [$m['label'],showVal($value),$m['unit'],metricStatus($m,$value)];
    $item=['label'=>$m['label'],'value'=>$value,'unit'=>$m['unit'],'status'=>metricStatus($m,$value)];
    if (in_array($key,['heart_rate','spo2','bp_systolic','bp_diastolic','respiratory_rate','body_temp'],true)) $physiology[]=$item;
    if (in_array($key,['hrv_rmssd','stress_level','steps','calories','sleep_quality','hydration'],true)) $biometric[]=$item;
    if ($m['group']==='environment') $environment[]=$item;
}
$sourceLabel = HERMES_DATA_SOURCE === 'api' ? 'Telemetry API' : 'Built-in simulation';
