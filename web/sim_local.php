<?php
// Persistent PHP-only telemetry. Full records are stored outside the document root.
require_once __DIR__ . '/config.php';
const SIM_STEP_SECONDS = 1;
const SIM_MAX_CATCHUP = 60;

function simScenarios(): array {
    return [
        '1' => ['name' => 'nominal', 'step_rate' => 4, 'cal_rate' => 1.4, 'ex_rate' => 0.0, 'targets' => [
            'heart_rate' => 72.0, 'spo2' => 98.0, 'bp_systolic' => 118.0, 'bp_diastolic' => 76.0,
            'respiratory_rate' => 15.0, 'body_temp' => 36.7, 'hrv_rmssd' => 48.0, 'stress_level' => 28.0,
            'hydration' => 82.0, 'eda' => 3.1, 'cortisol' => 12.5, 'emg_activity' => 22.0,
            'cabin_temp' => 22.2, 'cabin_humidity' => 45.0, 'cabin_co2' => 2.6, 'cabin_o2' => 20.9,
            'cabin_pressure' => 101.3, 'radiation' => 0.38, 'sensor_availability' => 99.6]],
        '2' => ['name' => 'eva_exertion', 'step_rate' => 38, 'cal_rate' => 9.5, 'ex_rate' => 0.5, 'targets' => [
            'heart_rate' => 136.0, 'spo2' => 96.0, 'bp_systolic' => 144.0, 'bp_diastolic' => 86.0,
            'respiratory_rate' => 26.0, 'body_temp' => 37.4, 'hrv_rmssd' => 26.0, 'stress_level' => 54.0,
            'hydration' => 63.0, 'eda' => 6.8, 'cortisol' => 18.0, 'emg_activity' => 74.0,
            'cabin_temp' => 22.8, 'cabin_humidity' => 49.0, 'cabin_co2' => 3.2, 'cabin_o2' => 20.7,
            'cabin_pressure' => 101.1, 'radiation' => 0.55, 'sensor_availability' => 99.2]],
        '3' => ['name' => 'eclss_hypoxia', 'step_rate' => 1, 'cal_rate' => 2.2, 'ex_rate' => 0.0, 'targets' => [
            'heart_rate' => 124.0, 'spo2' => 88.5, 'bp_systolic' => 138.0, 'bp_diastolic' => 88.0,
            'respiratory_rate' => 28.0, 'body_temp' => 36.4, 'hrv_rmssd' => 19.0, 'stress_level' => 84.0,
            'hydration' => 68.0, 'eda' => 8.4, 'cortisol' => 24.5, 'emg_activity' => 18.0,
            'cabin_temp' => 24.5, 'cabin_humidity' => 56.0, 'cabin_co2' => 6.4, 'cabin_o2' => 18.2,
            'cabin_pressure' => 96.8, 'radiation' => 0.42, 'sensor_availability' => 97.5]],
        '4' => ['name' => 'immune_radiation', 'step_rate' => 2, 'cal_rate' => 1.9, 'ex_rate' => 0.0, 'targets' => [
            'heart_rate' => 108.0, 'spo2' => 94.0, 'bp_systolic' => 132.0, 'bp_diastolic' => 85.0,
            'respiratory_rate' => 21.0, 'body_temp' => 38.6, 'hrv_rmssd' => 22.0, 'stress_level' => 78.0,
            'hydration' => 58.0, 'eda' => 7.5, 'cortisol' => 27.0, 'emg_activity' => 15.0,
            'cabin_temp' => 23.1, 'cabin_humidity' => 44.0, 'cabin_co2' => 3.0, 'cabin_o2' => 20.8,
            'cabin_pressure' => 101.2, 'radiation' => 1.45, 'sensor_availability' => 98.8]],
    ];
}

function simRecord(int $id, array $st, int $time): array {
    $v = $st['vals'];
    $clamp = fn($x, $lo, $hi) => max($lo, min($hi, $x));
    return [
        'astronaut_id' => $id,
        'scenario' => $st['scenario'],
        'heart_rate' => round($clamp($v['heart_rate'], 40.0, 210.0), 1),
        'spo2' => round($clamp($v['spo2'], 70.0, 100.0), 1),
        'bp_systolic' => (int)round($clamp($v['bp_systolic'], 80, 200)),
        'bp_diastolic' => (int)round($clamp($v['bp_diastolic'], 50, 130)),
        'respiratory_rate' => (int)round($clamp($v['respiratory_rate'], 8, 45)),
        'body_temp' => round($clamp($v['body_temp'], 34.5, 41.5), 1),
        'hrv_rmssd' => (int)round($clamp($v['hrv_rmssd'], 10, 120)),
        'stress_level' => (int)round($clamp($v['stress_level'], 5, 100)),
        'steps' => (int)$st['steps'],
        'calories' => (int)round($st['cal']),
        'sleep_hours' => 7.2,
        'sleep_quality' => 85,
        'hydration' => (int)round($clamp($v['hydration'], 30, 100)),
        'eda' => round($clamp($v['eda'], 0.5, 20.0), 1),
        'cortisol' => round($clamp($v['cortisol'], 2.0, 45.0), 1),
        'emg_activity' => (int)round($clamp($v['emg_activity'], 5, 100)),
        'exercise_minutes' => (int)round($st['ex']),
        'bone_loss_rate' => 0.8,
        'grip_strength' => 42.0,
        'cabin_temp' => round($v['cabin_temp'], 1),
        'cabin_humidity' => (int)round($v['cabin_humidity']),
        'cabin_co2' => round($v['cabin_co2'], 2),
        'cabin_o2' => round($v['cabin_o2'], 1),
        'cabin_pressure' => round($v['cabin_pressure'], 1),
        'radiation' => round($v['radiation'], 2),
        'sensor_availability' => round($clamp($v['sensor_availability'], 0, 100), 1),
        'recorded_at' => gmdate('Y-m-d H:i:s', $time),
    ];
}

function simAstronauts(): array {
    static $crew = null;
    return $crew ??= json_decode(file_get_contents(dirname(__DIR__).'/crew.json'), true, 512, JSON_THROW_ON_ERROR);
}
function simGauss(float $sigma): float {
    $u=mt_rand(1, mt_getrandmax())/mt_getrandmax(); $v=mt_rand()/mt_getrandmax();
    return sqrt(-2.0*log($u))*cos(2.0*M_PI*$v)*$sigma;
}
function simInitialState(): array {
    $crew=[];
    foreach ([1=>[6240,1830.0,95.0],2=>[5410,1690.0,70.0],3=>[7120,2010.0,110.0]] as $id=>$counters) {
        $crew[$id]=['vals'=>simScenarios()['1']['targets'],'steps'=>$counters[0],'cal'=>$counters[1],
            'ex'=>$counters[2],'scenario'=>'nominal','sc'=>'1','record'=>null];
    }
    // Epoch-based IDs avoid collisions if only the simulator state file is removed.
    return ['version'=>2,'scenario'=>'1','last'=>time()-1,'time'=>time(),
        'next_id'=>(int)(microtime(true)*1000000),'crew'=>$crew];
}
function simWriteAll($fh, string $data): void {
    $length=strlen($data); $written=0;
    while ($written<$length) {
        $n=fwrite($fh,substr($data,$written));
        if ($n===false || $n===0) throw new RuntimeException('Could not write telemetry storage.');
        $written+=$n;
    }
}
function simArchive(array $record): void {
    $folder=HERMES_STORAGE_DIR.'/history';
    if (!is_dir($folder) && !@mkdir($folder,0770,true) && !is_dir($folder)) throw new RuntimeException('History directory is not writable.');
    $file=$folder.'/crew-'.$record['astronaut_id'].'-'.substr($record['recorded_at'],0,10).'.jsonl';
    $fh=@fopen($file,'ab');
    if (!$fh) throw new RuntimeException('Cannot open history file.');
    try {
        if (!flock($fh,LOCK_EX)) throw new RuntimeException('Cannot lock history file.');
        simWriteAll($fh,json_encode($record,JSON_THROW_ON_ERROR)."\n"); fflush($fh);
    } finally { flock($fh,LOCK_UN); fclose($fh); }
}
function simStep(array &$state, int $timestamp, ?int $only=null): void {
    // Each crew member follows their own scenario ('sc'); older state files fall back to the global one.
    $all=simScenarios();
    foreach ($state['crew'] as $id=>&$st) {
        if ($only!==null && (int)$id!==$only) continue;
        $sc=$all[(string)($st['sc'] ?? $state['scenario'])] ?? $all['1'];
        foreach ($sc['targets'] as $key=>$target) {
            $st['vals'][$key]+=0.25*($target-$st['vals'][$key])+simGauss(max(0.02,abs($target)*0.008));
        }
        $st['steps']+=$sc['step_rate']; $st['cal']+=$sc['cal_rate']; $st['ex']+=$sc['ex_rate'];
        $st['scenario']=$sc['name'];
        $record=simRecord((int)$id,$st,$timestamp);
        $record['id']=$state['next_id']++;
        simArchive($record);
        $st['record']=$record;
    }
    unset($st);
    $state['time']=$timestamp;
}
function simState(?string $scenario=null, ?int $astro=null): ?array {
    static $cache=null;
    if ($cache!==null && $scenario===null) return $cache;
    if (!is_dir(HERMES_STORAGE_DIR) && !@mkdir(HERMES_STORAGE_DIR,0770,true) && !is_dir(HERMES_STORAGE_DIR)) return null;
    $lock=@fopen(HERMES_STORAGE_DIR.'/state.lock','c+');
    if (!$lock) return null;
    try {
        if (!flock($lock,LOCK_EX)) return null;
        $file=HERMES_STORAGE_DIR.'/state.json';
        $state=is_file($file)?json_decode((string)file_get_contents($file),true):null;
        $dirty=!is_array($state) || ($state['version']??0)!==2;
        if ($dirty) $state=simInitialState();
        $now=time();
        // At most 60 seconds are generated after idle time; older gaps stay visible.
        $due=max(0,min(SIM_MAX_CATCHUP,$now-(int)$state['last']));
        for ($i=$due-1;$i>=0;$i--) simStep($state,$now-$i);
        if ($due>0) { $state['last']=$now; $dirty=true; }
        if ($scenario!==null) {
            // With an astronaut id only that crew member changes; without one (legacy calls) everyone does.
            if ($astro===null) { $state['scenario']=$scenario; $dirty=true; }
            $ids=$astro===null ? array_keys($state['crew']) : (isset($state['crew'][$astro]) ? [$astro] : []);
            foreach ($ids as $cid) {
                if ((string)($state['crew'][$cid]['sc'] ?? '')===$scenario && $state['crew'][$cid]['record']!==null) continue;
                $state['crew'][$cid]['sc']=$scenario; simStep($state,$now,(int)$cid);
                $state['last']=$now; $dirty=true;
            }
        }
        if ($dirty) {
            $tmp=$file.'.tmp';
            if (file_put_contents($tmp,json_encode($state,JSON_THROW_ON_ERROR))===false || !rename($tmp,$file)) throw new RuntimeException('Cannot save simulator state.');
        }
        return $cache=$state;
    } finally { flock($lock,LOCK_UN); fclose($lock); }
}
// Read newest lines first without loading an entire daily archive into memory.
function simReverseLines(string $path): Generator {
    $fh=@fopen($path,'rb');
    if (!$fh) throw new RuntimeException('Cannot read a history file.');
    try {
        if (!flock($fh,LOCK_SH)) throw new RuntimeException('Cannot lock a history file.');
        fseek($fh,0,SEEK_END); $position=ftell($fh); $buffer='';
        while ($position>0) {
            $size=min(8192,$position); $position-=$size; fseek($fh,$position);
            $buffer=fread($fh,$size).$buffer;
            $lines=explode("\n",$buffer); $buffer=array_shift($lines);
            for ($i=count($lines)-1;$i>=0;$i--) if (trim($lines[$i])!=='') yield $lines[$i];
        }
        if (trim($buffer)!=='') yield $buffer;
    } finally { flock($fh,LOCK_UN); fclose($fh); }
}
function simHistory(array $query): array {
    $id=max(1,(int)($query['astronaut_id']??1));
    $limit=max(1,min(2000,(int)($query['limit']??300)));
    $files=glob(HERMES_STORAGE_DIR.'/history/crew-'.$id.'-*.jsonl')?:[];
    rsort($files,SORT_STRING); $records=[];
    $start=$query['start']??''; $end=$query['end']??'';
    if (isset($query['date'])) { $start=$query['date'].' 00:00:00'; $end=$query['date'].' 23:59:59'; }
    foreach ($files as $path) {
        foreach (simReverseLines($path) as $line) {
            $row=json_decode($line,true);
            if (!is_array($row) || !isset($row['id'],$row['recorded_at'])) continue;
            if (isset($query['before_id']) && $row['id'] >= (int)$query['before_id']) continue;
            if (isset($query['after_id']) && $row['id'] <= (int)$query['after_id']) continue;
            if ($end!=='' && $row['recorded_at']>$end) continue;
            if ($start!=='' && $row['recorded_at']<$start) continue;
            $records[]=$row;
            if (count($records)>$limit) break 2;
        }
    }
    $more=count($records)>$limit;
    if ($more) array_pop($records);
    return ['records'=>$records,'has_more'=>$more,'next_before_id'=>$more?end($records)['id']:null];
}
function simAlerts(array $d): array {
    $alerts=[];
    if ($d['spo2']<92 || $d['cabin_o2']<19.5) $alerts[]=['crit','ECLSS / Hypoxia',"Low blood oxygen ({$d['spo2']}%) or low cabin oxygen ({$d['cabin_o2']}%)."];
    if ($d['hydration']<65) $alerts[]=['crit','Hydration',"Critically low hydration ({$d['hydration']}%)."];
    elseif ($d['hydration']<72) $alerts[]=['warn','Hydration',"Hydration below the target range ({$d['hydration']}%)."];
    if ($d['body_temp']>=38) $alerts[]=['crit','Immune / Fever',"Elevated body temperature ({$d['body_temp']} °C)."];
    if ($d['radiation']>=1) $alerts[]=['warn','Radiation',"Elevated cabin radiation ({$d['radiation']} mSv/day)."];
    if ($d['stress_level']>=55 || $d['hrv_rmssd']<30) $alerts[]=['warn','Stress / HRV',"Elevated stress ({$d['stress_level']}/100) or reduced HRV ({$d['hrv_rmssd']} ms)."];
    if (!$alerts) $alerts[]=['ok','Nominal','All physiological and cabin measurements are in the nominal range.'];
    return $alerts;
}
function hermesLocalRequest(string $method,string $endpoint,?array $body=null): ?array {
    $path=(string)parse_url($endpoint,PHP_URL_PATH);
    parse_str((string)parse_url($endpoint,PHP_URL_QUERY),$query);
    if (strpos($path,'/api/checkins')===0) {
        require_once __DIR__ . '/checkin_lib.php';
        return hermesCheckinLocalRequest($method,$path,$query,$body);
    }
    if ($method==='POST' && $path==='/api/scenario') {
        $code=(string)($body['scenario']??'');
        if (!isset(simScenarios()[$code])) return null;
        $astro=isset($body['astronaut_id']) ? (int)$body['astronaut_id'] : null;
        return simState($code,$astro)?['status'=>'ok','active_scenario'=>$code,'astronaut_id'=>$astro]:null;
    }
    $state=simState();
    if (!$state) return null;
    $id=(int)($query['astronaut_id']??1);
    switch ($path) {
        case '/api/astronauts': return ['astronauts'=>simAstronauts()];
        case '/api/latest':
            if (isset($query['astronaut_id'])) return ['record'=>$state['crew'][$id]['record']??null];
            return ['records'=>array_values(array_filter(array_column($state['crew'], 'record'), 'is_array'))];
        case '/api/history': return simHistory($query);
        case '/api/alerts':
            $out=[];
            foreach ($state['crew'] as $aid=>$st) {
                if (!is_array($st['record'])) continue;
                foreach (simAlerts($st['record']) as [$type,$category,$message]) {
                    $out[]=['astronaut_id'=>(int)$aid,'alert_type'=>$type,'category'=>$category,'message'=>$message];
                }
            }
            return ['alerts'=>$out];
    }
    return null;
}
