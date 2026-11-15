<?php
// Conversational questions to the local Ollama model, with available crew telemetry.
// POST ?astro=N {"question":"…","history":[{"q":"…","a":"…"}]} starts a background job and returns its id;
// GET ?id=… returns the answer once the worker has written it. This endpoint never waits for Ollama.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function askOut(array $data): void {
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}
$dir = rtrim(sys_get_temp_dir(), '/\\') . DIRECTORY_SEPARATOR . 'hermes-ollama';

// ----- Poll an earlier question (cheap: only reads files)
if (isset($_GET['id'])) {
    $id = is_string($_GET['id']) ? $_GET['id'] : '';
    if (!preg_match('/^[a-f0-9]{16}$/', $id)) askOut(['status' => 'error', 'error' => 'Invalid request.']);
    $resultFile = "$dir/ask-$id.json";
    $pendingFile = "$dir/ask-$id.pending";
    if (is_file($resultFile)) {
        $r = json_decode((string)@file_get_contents($resultFile), true);
        if (is_array($r)) {
            askOut(['status' => ($r['status'] ?? '') === 'ok' ? 'ok' : 'error', 'text' => $r['text'] ?? null,
                'error' => $r['error'] ?? null, 'model' => $r['model'] ?? null]);
        }
    }
    if (is_file($pendingFile) && time() - (int)@filemtime($pendingFile) < 200) askOut(['status' => 'pending']);
    askOut(['status' => 'error', 'error' => 'The answer expired. Ask again.']);
}

// ----- New question
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') { http_response_code(405); askOut(['status' => 'error', 'error' => 'Use POST.']); }
if (strpos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') === false) { http_response_code(415); askOut(['status' => 'error', 'error' => 'Send JSON.']); }
$handleScenario = false;
require __DIR__ . '/api_client.php';
require_once __DIR__ . '/ai_context.php';
if (!HERMES_AI_ENABLED) askOut(['status' => 'error', 'error' => 'The AI assistant is turned off.']);
if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) askOut(['status' => 'error', 'error' => 'Cannot create the temporary folder.']);

$body = json_decode((string)file_get_contents('php://input', false, null, 0, 40000), true);
$question = is_array($body) && is_string($body['question'] ?? null) ? hermesAiClean($body['question'], 500) : '';
if ($question === '') askOut(['status' => 'error', 'error' => 'Type a question first.']);
$history = [];
foreach (array_slice(is_array($body['history'] ?? null) ? $body['history'] : [], -2) as $turn) {
    if (!is_array($turn) || !is_string($turn['q'] ?? null) || !is_string($turn['a'] ?? null)) continue;
    $history[] = ['role' => 'user', 'content' => hermesAiClean($turn['q'], 300)];
    $history[] = ['role' => 'assistant', 'content' => hermesAiClean($turn['a'], 600)];
}

$now = time();
$key = md5(HERMES_STORAGE_DIR . '|' . $astroId);
$lastFile = "$dir/ask-$key.last";
// One question at a time per visitor and crew member.
$last = is_file($lastFile) ? json_decode((string)@file_get_contents($lastFile), true) : null;
$lastId = is_array($last) ? (string)($last['id'] ?? '') : '';
if (preg_match('/^[a-f0-9]{16}$/', $lastId)) {
    $lastPending = "$dir/ask-$lastId.pending";
    if (is_file($lastPending) && $now - (int)@filemtime($lastPending) < 200) {
        askOut(['status' => 'busy', 'error' => 'Wait for the previous answer first.']);
    }
}
// Global cap so visitors cannot overload this PC.
$active = 0;
foreach (glob("$dir/*.pending") ?: [] as $f) if ($now - (int)@filemtime($f) < 200) $active++;
if ($active >= 3) askOut(['status' => 'busy', 'error' => 'The AI is busy. Try again in a moment.']);
foreach (glob("$dir/*") ?: [] as $f) if ($now - (int)@filemtime($f) > 86400) @unlink($f);

$context = ($crewRecords || $checkinLatest)
    ? hermesAiContext($astronauts, $crewRecords, $metrics, $statusText, $alertsByCrew, $crewAlertsAvailable, $checkinLatest)
    : 'Current crew telemetry is unavailable.';
$instructions = "You are Hermes, a professional and approachable assistant for a simulated spaceflight dashboard. Reply in "
    . HERMES_AI_LANGUAGE . ". Respond naturally to the latest user message. Resolve references in follow-ups using the recent conversation. "
    . "Use the full meaning of each message, including relevant astronaut names, sensor names, alerts, trends and scenario names. "
    . "For greetings, thanks, and farewells give a brief social reply only. For unrelated questions, briefly explain that you can help with crew telemetry, mental or ocular check-ins, or the dashboard. "
    . "For a factual question, comparison, or dashboard instruction, answer directly in plain text. Omit unsolicited advice, diagnoses, and extra sections. "
    . "For an ambiguous request, ask one short clarifying question. "
    . "Give operational advice only if the user asks what to do or requests a health assessment where a check is warranted. "
    . "Offer a tentative explanation only when the user asks for an interpretation or possible cause and simulated measurements support it. "
    . "Cite relevant readings, units and recent statistics when interpreting telemetry. Acknowledge missing or stale data. When relevant, report check-in findings and recorded changes from the personal baseline. Treat check-ins as screenings and label sample check-ins. "
    . "Do not invent readings, symptoms or causal links, treat scenario names as evidence, or prescribe treatment. "
    . "Use the named astronaut even if someone else is selected. For crew-wide requests cover everyone. "
    . "Use the selected astronaut when the user refers to that selection or leaves a crew-specific follow-up without another subject. "
    . "Examples: 'Thanks' calls for a brief acknowledgment. 'What is Maya's SpO₂?' calls for the reading. "
    . "'What should we check about her low reading?' calls for a relevant verification step. "
    . "'How do I cook rice?' calls for a brief redirect, even if the previous turn discussed a crew alert. "
    . "The selected astronaut is $crew. Earlier replies provide conversational context. Use the telemetry below for current facts.\n\n"
    . $context;
$messages = array_merge(
    [['role' => 'system', 'content' => $instructions]],
    $history,
    [['role' => 'user', 'content' => $question]]
);

$id = bin2hex(random_bytes(8));
$pendingFile = "$dir/ask-$id.pending";
$jobFile = "$dir/ask-$id.job.json";
$job = ['out' => "$dir/ask-$id.json", 'pending' => $pendingFile, 'job' => $jobFile, 'url' => HERMES_OLLAMA_URL,
    'model' => HERMES_OLLAMA_MODEL, 'messages' => $messages, 'num_ctx' => $checkinLatest ? 6144 : 4096, 'num_predict' => 500, 'max_chars' => 2400];
if (@file_put_contents($pendingFile, '1') === false
    || @file_put_contents($jobFile, json_encode($job, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE)) === false
    || !hermesAiSpawn($jobFile)) {
    @unlink($pendingFile);
    @unlink($jobFile);
    askOut(['status' => 'error', 'error' => 'Could not start the background AI process.']);
}
@file_put_contents($lastFile, json_encode(['id' => $id, 'time' => $now]));
askOut(['status' => 'pending', 'id' => $id]);
