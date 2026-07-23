<?php
/**
 * Same-origin SSE / snapshot for Vosk ASR live state.
 *
 * State files: /run/nexbreak/asr/<service_name>.json
 * written by nexbreak-caption-worker.
 *
 *   GET /asr.php?service=1         → text/event-stream
 *   GET /asr.php?service=1&once=1  → application/json snapshot
 */
declare(strict_types=1);

function asr_state_dir(): string
{
    $env = getenv('NEXBREAK_ASR_DIR');
    if (is_string($env) && $env !== '') {
        return rtrim($env, "/\\");
    }
    return '/run/nexbreak/asr';
}

function asr_normalize_service(?string $svc): ?string
{
    if ($svc === null || $svc === '') {
        return null;
    }
    $svc = trim($svc);
    if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/', $svc)) {
        return null;
    }
    return $svc;
}

/** @return array<string,mixed> */
function asr_empty(string $svc): array
{
    return [
        'service_name' => $svc,
        'vosk_loaded' => false,
        'model' => '',
        'reason' => '',
        'cue_connected' => false,
        'state' => 'unknown',
        'partial' => '',
        'final' => '',
        'seq' => 0,
        'ts' => 0.0,
        'audio_tap_alive' => false,
    ];
}

/** @return array<string,mixed> */
function asr_read(string $svc): array
{
    $file = asr_state_dir() . '/' . $svc . '.json';
    if (!is_readable($file)) {
        return asr_empty($svc);
    }
    $raw = @file_get_contents($file);
    if ($raw === false || $raw === '') {
        return asr_empty($svc);
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        return asr_empty($svc);
    }
    $out = asr_empty($svc);
    foreach (
        [
            'vosk_loaded',
            'model',
            'reason',
            'cue_connected',
            'state',
            'partial',
            'final',
            'seq',
            'ts',
            'audio_tap_alive',
        ] as $k
    ) {
        if (array_key_exists($k, $data)) {
            $out[$k] = $data[$k];
        }
    }
    foreach (['partial', 'final', 'reason', 'model', 'state'] as $k) {
        if (is_string($out[$k]) && strlen($out[$k]) > 2000) {
            $out[$k] = substr($out[$k], 0, 2000);
        }
        if (is_string($out[$k])) {
            $out[$k] = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $out[$k]) ?? '';
        }
    }
    $out['service_name'] = $svc;
    return $out;
}

$svc = asr_normalize_service(isset($_GET['service']) ? (string) $_GET['service'] : null);
if ($svc === null) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'service required (e.g. 1)']);
    exit;
}

$once = isset($_GET['once']) && $_GET['once'] !== '0' && $_GET['once'] !== '';

if ($once) {
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    echo json_encode(['ok' => true] + asr_read($svc));
    exit;
}

header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('Connection: keep-alive');
header('X-Accel-Buffering: no');
if (function_exists('apache_setenv')) {
    @apache_setenv('no-gzip', '1');
}
@ini_set('zlib.output_compression', '0');
@ini_set('output_buffering', 'off');
while (ob_get_level() > 0) {
    ob_end_flush();
}

$lastSeq = -1;
$ticks = 0;
while (!connection_aborted() && $ticks < 3600) {
    $state = asr_read($svc);
    if ((int) $state['seq'] !== $lastSeq) {
        $lastSeq = (int) $state['seq'];
        echo 'data: ' . json_encode($state) . "\n\n";
        flush();
    } else {
        echo ": ping\n\n";
        flush();
    }
    usleep(400000);
    $ticks++;
}
