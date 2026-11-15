<?php
// Hermes supports the built-in PHP simulator or the optional Python telemetry API.
define('HERMES_DATA_SOURCE', getenv('HERMES_DATA_SOURCE') ?: 'local');
define('HERMES_API_URL', getenv('HERMES_API_URL') ?: 'http://127.0.0.1:8000');
define('HERMES_API_KEY', getenv('HERMES_API_KEY') ?: 'hermes-local-demo-key');
// Optional crew AI assistant (floating button on every page), written by a local Ollama model.
define('HERMES_AI_ENABLED', getenv('HERMES_AI') !== '0');
define('HERMES_OLLAMA_URL', getenv('HERMES_OLLAMA_URL') ?: 'http://127.0.0.1:11434');
define('HERMES_OLLAMA_MODEL', getenv('HERMES_OLLAMA_MODEL') ?: 'llama3.2');
define('HERMES_AI_TTL', max(15, (int)(getenv('HERMES_AI_TTL') ?: 60)));
define('HERMES_AI_LANGUAGE', getenv('HERMES_AI_LANGUAGE') ?: 'English');
// Keep persistent telemetry outside the public web directory. This folder must be writable.
// Built-in mode: every visitor (browser) gets a private simulation and history, so one person
// changing the scenario never changes what someone else sees. A visitor is identified by the
// random 'hermes_viewer' cookie. Set HERMES_STORAGE_DIR (or HERMES_PER_VIEWER=0) to keep ONE
// simulation shared by everybody, and note API mode always shares the Python server's data.
function hermesRemoveTree(string $dir): void {
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($it as $item) {
        if ($item->isDir() && !$item->isLink()) @rmdir($item->getPathname()); else @unlink($item->getPathname());
    }
    @rmdir($dir);
}
function hermesStorageDir(): string {
    $base = getenv('HERMES_STORAGE_DIR') ?: dirname(__DIR__) . '/storage';
    if (getenv('HERMES_STORAGE_DIR') || getenv('HERMES_PER_VIEWER') === '0'
        || HERMES_DATA_SOURCE === 'api' || PHP_SAPI === 'cli') return $base;
    $id = $_COOKIE['hermes_viewer'] ?? '';
    if (!is_string($id) || !preg_match('/^[a-f0-9]{24}$/', $id)) {
        // First visit: hand out the cookie. This one request uses the shared default folder;
        // the page's next requests carry the cookie and use the visitor's own folder.
        if (!headers_sent()) {
            setcookie('hermes_viewer', bin2hex(random_bytes(12)),
                ['expires' => time() + 30 * 86400, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax']);
        }
        return $base;
    }
    $root = $base . '/viewers';
    $dir = $root . '/' . $id;
    if (is_dir($dir)) return $dir;
    // New visitor folder: drop folders idle for 14 days and cap the total at 200.
    $dirs = glob($root . '/*', GLOB_ONLYDIR) ?: [];
    $cut = time() - 14 * 86400;
    foreach ($dirs as $i => $old) {
        $m = @filemtime($old . '/state.json');
        if ($m !== false && $m < $cut) { hermesRemoveTree($old); unset($dirs[$i]); }
    }
    return count($dirs) >= 200 ? $base : $dir;
}
define('HERMES_STORAGE_DIR', hermesStorageDir());
// Health check-ins belong to the mission, not to one browser: they always use the shared folder.
define('HERMES_SHARED_DIR', getenv('HERMES_STORAGE_DIR') ?: dirname(__DIR__) . '/storage');
// First day of the mission (UTC, YYYY-MM-DD); check-ins derive their mission day from it.
define('HERMES_MISSION_START', preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)getenv('HERMES_MISSION_START')) ? getenv('HERMES_MISSION_START') : '2026-11-01');
define('HERMES_SCENARIOS', [
    '1' => ['name' => 'nominal', 'label' => 'Nominal', 'chip' => 'ok'],
    '2' => ['name' => 'eva_exertion', 'label' => 'EVA / Exertion', 'chip' => 'warn'],
    '3' => ['name' => 'eclss_hypoxia', 'label' => 'ECLSS Hypoxia', 'chip' => 'crit'],
    '4' => ['name' => 'immune_radiation', 'label' => 'Fever / Radiation', 'chip' => 'crit'],
]);
