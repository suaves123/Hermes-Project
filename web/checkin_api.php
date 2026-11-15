<?php
// Check-in endpoint for the health check-in page.
//   GET  ?action=list[&astro=N]   stored check-ins, newest first
//   GET  ?action=audio&id=…       the voice note of one check-in
//   POST ?action=submit  (JSON)   validate, assess against the baseline, and store one check-in
//   POST ?action=clear   (JSON)   remove every stored check-in and voice note
require_once __DIR__ . '/checkin_lib.php';

function ckOut(array $data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}
$action = is_string($_GET['action'] ?? null) ? $_GET['action'] : 'list';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$audioDir = HERMES_SHARED_DIR . '/checkins/audio';
$audioTypes = ['webm' => 'audio/webm', 'mp4' => 'audio/mp4'];

if ($method === 'GET' && $action === 'audio') {
    $id = is_string($_GET['id'] ?? null) ? $_GET['id'] : '';
    if (preg_match('/^[a-f0-9]{16}$/', $id)) {
        foreach ($audioTypes as $ext => $type) {
            $file = "$audioDir/$id.$ext";
            if (!is_file($file)) continue;
            header('Content-Type: ' . $type);
            header('Content-Length: ' . filesize($file));
            header('Cache-Control: private, max-age=3600');
            header('X-Content-Type-Options: nosniff');
            readfile($file);
            exit;
        }
    }
    ckOut(['error' => 'Voice note not found.'], 404);
}
if ($method === 'GET' && $action === 'list') {
    $query = ['limit' => 1000];
    if (isset($_GET['astro'])) $query['astronaut_id'] = max(1, (int)$_GET['astro']);
    $rows = hermesCheckinList($query);
    if ($rows === null) ckOut(['error' => hermesErrorMessage()], 503);
    ckOut(['checkins' => $rows, 'mission_day' => ckMissionDay(time()), 'limits' => CK_LIMITS, 'server_time' => gmdate('Y-m-d\TH:i:s\Z')]);
}
if ($method !== 'POST' || !in_array($action, ['submit', 'clear'], true)) ckOut(['error' => 'Unsupported request.'], 405);
if (strpos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') === false) ckOut(['error' => 'Send JSON.'], 415);

if ($action === 'clear') {
    if (hermesApiRequest('POST', '/api/checkins/clear', ['confirm' => true]) === null) ckOut(['error' => hermesErrorMessage()], 503);
    foreach (glob($audioDir . '/*') ?: [] as $file) @unlink($file);
    ckOut(['ok' => true]);
}

$raw = (string)file_get_contents('php://input', false, null, 0, 4 * 1024 * 1024);
$in = json_decode($raw, true);
if (!is_array($in)) ckOut(['error' => 'The check-in could not be read.'], 400);
$crew = hermesApiGet('/api/astronauts');
if ($crew === null) ckOut(['error' => hermesErrorMessage()], 503);
$crewIds = array_map(fn($a) => (int)($a['id'] ?? 0), hermesRows($crew['astronauts'] ?? null));
try {
    $record = hermesCheckinNormalize($in, $crewIds, time());
} catch (InvalidArgumentException $e) {
    ckOut(['error' => $e->getMessage()], 422);
}
$history = hermesCheckinList(['astronaut_id' => $record['astronaut_id'], 'limit' => 1000]);
if ($history === null) ckOut(['error' => hermesErrorMessage()], 503);
$baseline = null;
foreach ($history as $row) {   // newest first
    if (!empty($row['is_baseline']) && strcmp((string)$row['timestamp_utc'], $record['timestamp_utc']) <= 0) { $baseline = $row; break; }
}
if ($baseline === null || ($in['set_baseline'] ?? false) === true) { $record['is_baseline'] = true; $baseline = null; }
$record['assessment'] = hermesCheckinAssess($record, $baseline);

// The voice note is kept as a file next to the check-ins; only its name goes into the record.
$audio = $in['psych_data']['audio_blob_base64'] ?? null;
if (is_string($audio) && $audio !== '') {
    $mime = strtolower(trim(explode(';', (string)($in['psych_data']['audio_mime'] ?? 'audio/webm'), 2)[0]));
    $ext = array_search($mime, $audioTypes, true);
    $bytes = base64_decode($audio, true);
    if ($ext === false || $bytes === false || strlen($bytes) < 64 || strlen($bytes) > 2 * 1024 * 1024) ckOut(['error' => 'The voice note is not valid or is too large.'], 422);
    if ((!is_dir($audioDir) && !@mkdir($audioDir, 0770, true) && !is_dir($audioDir))
        || @file_put_contents("$audioDir/{$record['id']}.$ext", $bytes, LOCK_EX) === false) ckOut(['error' => 'The voice note could not be saved.'], 500);
    $record['psych_data']['audio_file'] = "{$record['id']}.$ext";
}
if (hermesApiRequest('POST', '/api/checkins', $record) === null) {
    if ($record['psych_data']['audio_file']) @unlink($audioDir . '/' . $record['psych_data']['audio_file']);
    ckOut(['error' => hermesErrorMessage()], 503);
}
ckOut(['ok' => true, 'checkin' => $record, 'baseline' => $baseline]);
