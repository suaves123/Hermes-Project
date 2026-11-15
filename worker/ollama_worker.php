<?php
// Background worker: asks Ollama for a summary or answer and writes the result file. Command line only.
// It lives outside the web folder on purpose and refuses to run from a web request.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$jobPath = $argv[1] ?? '';
$job = is_file($jobPath) ? json_decode((string)file_get_contents($jobPath), true) : null;
if (!is_array($job) || !isset($job['out'], $job['pending'], $job['url'], $job['model'])) exit(1);
$chat = isset($job['messages']);
if (!$chat && !isset($job['prompt'])) exit(1);

$result = ['status' => 'error', 'error' => 'Unknown error.', 'model' => $job['model']];
try {
    $input = $chat ? ['messages' => $job['messages']] : ['prompt' => $job['prompt']];
    $payload = json_encode($input + [
        'model' => $job['model'], 'stream' => false, 'keep_alive' => '10m',
        'options' => ['temperature' => 0.3, 'num_ctx' => (int)($job['num_ctx'] ?? 4096), 'num_predict' => max(64, min(800, (int)($job['num_predict'] ?? 260)))],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $url = rtrim($job['url'], '/') . ($chat ? '/api/chat' : '/api/generate');
    $raw = false;
    $code = 0;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 150,
            CURLOPT_POST => true, CURLOPT_POSTFIELDS => $payload, CURLOPT_HTTPHEADER => ['Content-Type: application/json']]);
        $raw = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        unset($ch);
    } else {
        $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => "Content-Type: application/json\r\n",
            'content' => $payload, 'timeout' => 150, 'ignore_errors' => true]]);
        $raw = @file_get_contents($url, false, $ctx);
        foreach ($http_response_header ?? [] as $line) {
            if (preg_match('~^HTTP/\S+\s+(\d{3})~', $line, $m)) $code = (int)$m[1];
        }
    }
    if ($raw === false || $code === 0) {
        $result['error'] = 'Ollama is not reachable at ' . $job['url'] . '. Start Ollama and check HERMES_OLLAMA_URL.';
    } else {
        $data = json_decode((string)$raw, true);
        if ($code !== 200 || !is_array($data)) {
            $detail = is_array($data) && isset($data['error']) && is_string($data['error']) ? $data['error'] : 'HTTP ' . $code;
            $result['error'] = 'Ollama replied: ' . $detail . ' (try: ollama pull ' . $job['model'] . ')';
        } else {
            // Reasoning models may prepend <think>…</think>; keep only the answer.
            $answer = $chat ? ($data['message']['content'] ?? '') : ($data['response'] ?? '');
            $text = trim((string)preg_replace('~<think>.*?</think>~s', '', (string)$answer));
            if ($text === '') {
                $result['error'] = 'The model returned an empty answer.';
            } else {
                $result = ['status' => 'ok', 'text' => (preg_match('/^.{0,' . max(200, min(4000, (int)($job['max_chars'] ?? 1200))) . '}/su', $text, $cut) ? $cut[0] : substr($text, 0, 1200)), 'model' => $job['model']];
            }
        }
    }
} catch (Throwable $e) {
    $result['error'] = 'AI request failed: ' . $e->getMessage();
} finally {
    $result['generated'] = time();
    $tmp = $job['out'] . '.tmp';
    if (@file_put_contents($tmp, json_encode($result, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE)) !== false) {
        @rename($tmp, $job['out']);
    }
    @unlink($job['pending']);
    if (isset($job['job'])) @unlink($job['job']);
}
