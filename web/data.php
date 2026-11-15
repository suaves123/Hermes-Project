<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
require __DIR__ . '/api_client.php';
$section=is_string($_GET['section'] ?? null) ? $_GET['section'] : 'index';
$parts=$section==='index'
    ? ['physiology'=>'physiology','biometric'=>'biometric','environment'=>'environment','notice'=>'notice','scenarioButtons'=>'scenario_buttons']
    : ['readings'=>'readings','notice'=>'notice','scenarioButtons'=>'scenario_buttons'];
$parts['missionAlerts']='mission_alerts';
$rows=$subpageRows[$section] ?? [];
$html=[];
foreach ($parts as $key=>$file) {
    ob_start(); include __DIR__.'/partials/'.$file.'.php'; $html[$key]=trim(ob_get_clean());
}
echo json_encode(['astroId'=>$astroId,'crew'=>$crew,'apiOnline'=>$apiOnline,'apiMessage'=>$apiStatusMsg,
    'scenario'=>$scenario,'scenarioLabels'=>array_map(fn($s)=>$s['label'],$scenarios),'crewScope'=>$crewScope,
    'hasData'=>(bool)$t,'recordedAt'=>$t['recorded_at'] ?? null,'record'=>$t,'source'=>$sourceLabel,
    'html'=>$html,'scenarioResult'=>$scenarioResult,
    'crewRecords'=>array_values($crewRecords),'astronauts'=>array_values($astronauts),'alertsByCrew'=>(object)$alertsByCrew], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
