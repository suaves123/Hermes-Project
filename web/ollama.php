<?php
// POST requests a summary for the entire crew. GET only checks an existing result.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function aiOut(array $data): void {
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$start = $method === 'POST';
$requestedScope = $_GET['scope'] ?? null;
if (!$start && $method !== 'GET') {
    header('Allow: GET, POST');
    http_response_code(405);
    aiOut(['status' => 'error', 'error' => 'Use POST to request a summary or GET to check its status.']);
}
if (!$start && (!is_string($requestedScope) || !preg_match('/^[a-f0-9]{32}$/', $requestedScope))) {
    http_response_code(400);
    aiOut(['status' => 'error', 'error' => 'Request a summary with POST before checking its status.']);
}
if ($start) {
    $contentType = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '', 2)[0]));
    if ($contentType !== 'application/json') {
        http_response_code(415);
        aiOut(['status' => 'error', 'error' => 'Send JSON to request an AI summary.']);
    }
    $body = json_decode((string)file_get_contents('php://input', false, null, 0, 1024), true);
    if (($body['action'] ?? null) !== 'summarize') {
        http_response_code(400);
        aiOut(['status' => 'error', 'error' => 'Missing summary request.']);
    }
}

$handleScenario = false;
require __DIR__ . '/api_client.php';
require_once __DIR__ . '/ai_context.php';
if (!HERMES_AI_ENABLED) aiOut(['status' => 'disabled', 'error' => 'The AI assistant is turned off.']);
if (!$crewRecords && !$checkinLatest) aiOut(['status' => 'waiting', 'error' => 'No crew readings yet. Request a summary once telemetry arrives.']);

if (!$start && $requestedScope !== $crewScope) {
    aiOut(['status' => 'error', 'error' => 'Crew or scenario changed. Request a new summary.']);
}
$dir = rtrim(sys_get_temp_dir(), '/\\') . DIRECTORY_SEPARATOR . 'hermes-ollama';
if ($start && !is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
    aiOut(['status' => 'error', 'error' => 'Cannot create the temporary folder for AI summaries.']);
}
$key = md5(HERMES_STORAGE_DIR . '|crew-screening-assessment|' . $crewScope);
$resultFile = "$dir/$key.json";
$pendingFile = "$dir/$key.pending";
$jobFile = "$dir/$key.job.json";
$now = time();

$pending = is_file($pendingFile) && $now - (int)@filemtime($pendingFile) < 180;
$res = null;
if (is_file($resultFile)) {
    $decoded = json_decode((string)@file_get_contents($resultFile), true);
    if (is_array($decoded)) $res = $decoded;
}
$ttl = ($res['status'] ?? '') === 'ok' ? HERMES_AI_TTL : 30;
$fresh = $res !== null && $now - (int)($res['generated'] ?? 0) < $ttl;
$busy = false;
$spawnError = null;

if ($start && !$fresh && !$pending) {
    if (is_file($pendingFile)) @unlink($pendingFile);
    $active = 0;
    foreach (glob("$dir/*.pending") ?: [] as $f) if ($now - (int)@filemtime($f) < 180) $active++;
    if ($active >= 2) {
        $busy = true;
    } else {
        foreach (glob("$dir/*") ?: [] as $f) if ($now - (int)@filemtime($f) > 86400) @unlink($f);
        $fh = @fopen($pendingFile, 'x'); // exclusive create: only one request starts the job
        if ($fh) {
            fclose($fh);
            $prompt = hermesAiInstructions()
                . "Use a short paragraph per astronaut starting with their full name. Cite relevant measurements and recent statistics. "
                . "Include significant findings from the latest mental and ocular screening, and compare with the astronaut’s own baseline when available. "
                . "Explain any missing evidence and suggest one operational check when warranted. Include all astronauts.\n\n"
                . hermesAiContext($astronauts, $crewRecords, $metrics, $statusText, $alertsByCrew, $crewAlertsAvailable, $checkinLatest);
            $job = ['out' => $resultFile, 'pending' => $pendingFile, 'job' => $jobFile, 'url' => HERMES_OLLAMA_URL,
                'model' => HERMES_OLLAMA_MODEL, 'prompt' => $prompt, 'num_ctx' => $checkinLatest ? 6144 : 4096, 'num_predict' => 500, 'max_chars' => 2400];
            if (@file_put_contents($jobFile, json_encode($job, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE)) !== false && hermesAiSpawn($jobFile)) {
                $pending = true;
            } else {
                @unlink($pendingFile);
                $spawnError = 'Could not start the background AI process.';
            }
        } else {
            $pending = true; // another request just started it
        }
    }
}

if ($spawnError) aiOut(['status' => 'error', 'error' => $spawnError]);
if ($busy) aiOut(['status' => 'busy', 'error' => 'The AI is busy. Request a summary again in a moment.']);
if ($pending) aiOut(['status' => 'pending', 'scope' => $crewScope]);
if ($fresh) aiOut($res + ['scope' => $crewScope]);
aiOut(['status' => 'error', 'error' => 'No AI summary is ready. Request a new summary.']);
