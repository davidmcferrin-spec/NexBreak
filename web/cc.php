<?php
/**
 * Same-origin SSE for closed-caption cues (NexVUE pattern).
 *
 * State files: /run/nexbreak/captions/<preview_path>.json
 * written by nexbreak-cc-watch (ccextractor → text).
 *
 *   GET /cc.php?path=nb1         → text/event-stream
 *   GET /cc.php?path=nb1&once=1  → application/json snapshot
 */
declare(strict_types=1);

function cc_state_dir(): string
{
    $env = getenv('NEXBREAK_CAPTIONS_DIR');
    if (is_string($env) && $env !== '') {
        return rtrim($env, "/\\");
    }
    return '/run/nexbreak/captions';
}

function cc_normalize_path(?string $path): ?string
{
    if ($path === null || $path === '') {
        return null;
    }
    $path = trim($path);
    if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/', $path)) {
        return null;
    }
    return $path;
}

/** @return array{channel:string,text:string,clear:bool,ts:float,seq:int,service:string} */
function cc_empty(string $channel): array
{
    return [
        'channel' => $channel,
        'text' => '',
        'clear' => true,
        'ts' => 0.0,
        'seq' => 0,
        'service' => 'CC1',
    ];
}

/** @return array{channel:string,text:string,clear:bool,ts:float,seq:int,service:string} */
function cc_read(string $channel): array
{
    $file = cc_state_dir() . '/' . $channel . '.json';
    if (!is_readable($file)) {
        return cc_empty($channel);
    }
    $raw = @file_get_contents($file);
    if ($raw === false || $raw === '') {
        return cc_empty($channel);
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        return cc_empty($channel);
    }
    $text = isset($data['text']) ? (string) $data['text'] : '';
    if (strlen($text) > 2000) {
        $text = substr($text, 0, 2000);
    }
    $text = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $text) ?? '';
    if ($text !== '') {
        clearstatcache(true, $file);
        $mtime = @filemtime($file);
        if ($mtime !== false && (time() - $mtime) > 60) {
            $text = '';
        }
    }
    return [
        'channel' => $channel,
        'text' => $text,
        'clear' => $text === '' || !empty($data['clear']),
        'ts' => isset($data['ts']) ? (float) $data['ts'] : 0.0,
        'seq' => isset($data['seq']) ? (int) $data['seq'] : 0,
        'service' => isset($data['service']) ? (string) $data['service'] : 'CC1',
    ];
}

$path = cc_normalize_path(isset($_GET['path']) ? (string) $_GET['path'] : null);
if ($path === null) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'path required (e.g. nb1)']);
    exit;
}

$once = isset($_GET['once']) && $_GET['once'] !== '0' && $_GET['once'] !== '';

if ($once) {
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    echo json_encode(['ok' => true] + cc_read($path));
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
    $state = cc_read($path);
    if ((int) $state['seq'] !== $lastSeq) {
        $lastSeq = (int) $state['seq'];
        echo 'data: ' . json_encode($state) . "\n\n";
        flush();
    } else {
        // Keepalive comment so proxies don't drop the stream.
        echo ": ping\n\n";
        flush();
    }
    usleep(400000);
    $ticks++;
}
