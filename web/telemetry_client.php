<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/sim_local.php';
$hermesApiError = '';
function hermesApiGet(string $endpoint): ?array { return hermesApiRequest('GET', $endpoint); }
function hermesApiRequest(string $method, string $endpoint, ?array $body = null): ?array {
    global $hermesApiError;
    $hermesApiError = '';
    if (HERMES_DATA_SOURCE !== 'api') {
        try { $data = hermesLocalRequest($method, $endpoint, $body); }
        catch (Throwable $e) { error_log('Hermes storage error: ' . $e->getMessage()); $data = null; }
        if ($data === null) $hermesApiError = 'local';
        return $data;
    }
    $url = rtrim(HERMES_API_URL, '/') . $endpoint;
    $headers = ['X-API-Key: '.HERMES_API_KEY, 'Accept: application/json', 'Content-Type: application/json'];
    $json = $body !== null ? json_encode($body) : null;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER=>true, CURLOPT_CONNECTTIMEOUT=>2,
            CURLOPT_TIMEOUT=>10, CURLOPT_CUSTOMREQUEST=>$method, CURLOPT_HTTPHEADER=>$headers]);
        if ($json !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $json);
        $response = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        unset($ch);
    } else {
        $context = stream_context_create(['http'=>['method'=>$method, 'header'=>implode("\r\n", $headers),
            'content'=>$json ?? '', 'timeout'=>10, 'ignore_errors'=>true]]);
        $response = @file_get_contents($url, false, $context);
        $code = 0;
        foreach ($http_response_header ?? [] as $line) {
            if (preg_match('~^HTTP/\S+\s+(\d{3})~', $line, $m)) $code = (int)$m[1];
        }
    }
    if ($response === false || $code === 0) { $hermesApiError='connection'; return null; }
    if ($code !== 200) { $hermesApiError='http_'.$code; return null; }
    $data = json_decode($response, true);
    if (!is_array($data)) { $hermesApiError='json'; return null; }
    return $data;
}
function hermesText($value, string $default = ''): string {
    return is_scalar($value) && !is_bool($value) ? (string)$value : $default;
}
function hermesRows($value): array {
    return is_array($value) ? array_values(array_filter($value, 'is_array')) : [];
}
function hermesErrorMessage(): string {
    global $hermesApiError;
    if ($hermesApiError === 'local') return 'The simulator could not read or write its history. Check permissions on the storage folder.';
    if (in_array($hermesApiError, ['http_401','http_403'], true)) return 'The API rejected the key. Match HERMES_API_KEY in the web and Python settings.';
    if (strpos($hermesApiError, 'http_') === 0) return 'The telemetry API returned HTTP ' . substr($hermesApiError, 5) . '. Check the API console.';
    if ($hermesApiError === 'json') return 'The telemetry server returned invalid JSON. Check HERMES_API_URL.';
    return 'Telemetry is unavailable. Check the API server, address, and network connection.';
}
