<?php
// One catalog supplies chart labels, units, current readings, and historical tables.
function hermesMetrics(): array {
    $rows = [
        ['heart_rate', 'Heart rate', 'bpm', 'cardiovascular', 1, [55,100,45,130]],
        ['spo2', 'Blood oxygen (SpO₂)', '%', 'cardiovascular', 1, [95,100,91,100]],
        ['bp_systolic', 'Systolic blood pressure', 'mmHg', 'cardiovascular', 0, [90,125,80,140]],
        ['bp_diastolic', 'Diastolic blood pressure', 'mmHg', 'cardiovascular', 0, [60,82,50,95]],
        ['respiratory_rate', 'Respiratory rate', 'breaths/min', 'cardiovascular', 0, [12,20,9,26]],
        ['hrv_rmssd', 'Heart rate variability (RMSSD)', 'ms', 'cardiovascular', 0, [35,100,22,120]],
        ['emg_activity', 'Muscle activity (EMG)', '% MVC', 'musculoskeletal', 0, null],
        ['exercise_minutes', 'Exercise duration', 'min', 'musculoskeletal', 0, [60,10000,0,10000]],
        ['bone_loss_rate', 'Estimated bone loss', '%/month', 'musculoskeletal', 1, [0,1,0,1.5]],
        ['grip_strength', 'Grip strength', 'kg', 'musculoskeletal', 1, [38,60,30,65]],
        ['steps', 'Steps', 'steps', 'musculoskeletal', 0, null],
        ['stress_level', 'Stress level', '/100', 'immune_stress', 0, [0,50,0,75]],
        ['eda', 'Electrodermal activity (EDA)', 'µS', 'immune_stress', 1, [1,6,0.5,9]],
        ['cortisol', 'Cortisol', 'µg/dL', 'immune_stress', 1, [5,20,2,25]],
        ['body_temp', 'Body temperature', '°C', 'immune_stress', 1, [36,37.5,35,38.2]],
        ['calories', 'Energy expenditure', 'kcal', 'energy_sleep', 0, null],
        ['sleep_hours', 'Sleep duration', 'h', 'energy_sleep', 1, [6.5,9,5,11]],
        ['sleep_quality', 'Sleep quality', '%', 'energy_sleep', 0, [75,100,60,100]],
        ['hydration', 'Hydration', '%', 'energy_sleep', 0, [75,100,65,100]],
        ['cabin_temp', 'Cabin temperature', '°C', 'environment', 1, null],
        ['cabin_humidity', 'Cabin humidity', '%', 'environment', 0, null],
        ['cabin_co2', 'Cabin carbon dioxide', 'mmHg', 'environment', 2, null],
        ['cabin_o2', 'Cabin oxygen', '%', 'environment', 1, null],
        ['cabin_pressure', 'Cabin pressure', 'kPa', 'environment', 1, null],
        ['radiation', 'Radiation', 'mSv/day', 'environment', 2, null],
        ['sensor_availability', 'Sensor availability', '%', 'environment', 1, null],
    ];
    $out = [];
    foreach ($rows as [$key, $label, $unit, $group, $digits, $range]) {
        $out[$key] = compact('key', 'label', 'unit', 'group', 'digits', 'range');
    }
    return $out;
}
function hermesGroups(): array {
    return ['cardiovascular'=>'Cardiovascular', 'musculoskeletal'=>'Musculoskeletal',
        'immune_stress'=>'Immune & stress', 'energy_sleep'=>'Energy & sleep', 'environment'=>'Environment & sensors'];
}
