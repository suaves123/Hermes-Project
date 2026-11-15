<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
require_once __DIR__ . '/telemetry_client.php';
$params=['astronaut_id'=>max(1,(int)($_GET['astro'] ?? 1)), 'limit'=>min(1000,max(1,(int)($_GET['limit'] ?? 1000)))];
foreach (['before_id','after_id'] as $key) if (isset($_GET[$key])) $params[$key]=max(0,(int)$_GET[$key]);
foreach (['start','end'] as $key) {
    if (!isset($_GET[$key])) continue;
    $value=$_GET[$key];
    $date=is_string($value) ? DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $value, new DateTimeZone('UTC')) : false;
    if (!$date || $date->format('Y-m-d H:i:s') !== $value) {
        http_response_code(400); echo json_encode(['error'=>'Invalid UTC date filter.']); exit;
    }
    $params[$key]=$value;
}
if (isset($params['start'],$params['end']) && $params['start'] > $params['end']) {
    http_response_code(400); echo json_encode(['error'=>'The start date must precede the end date.']); exit;
}
$response=hermesApiGet('/api/history?'.http_build_query($params));
if ($response === null) { http_response_code(503); echo json_encode(['error'=>hermesErrorMessage()]); exit; }
echo json_encode($response, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
