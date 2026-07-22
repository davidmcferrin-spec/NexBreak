<?php
/**
 * Quick diagnostic for the API proxy / controller link.
 * Open http://<host>/api/diag.php from the workstation (then remove or restrict).
 */
declare(strict_types=1);

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/include/config.php';

$base = nexbreak_api_base();
$out = [
    'ok' => true,
    'php' => PHP_VERSION,
    'api_base' => $base,
    'curl' => function_exists('curl_init'),
    'allow_url_fopen' => (bool) ini_get('allow_url_fopen'),
    'controller' => null,
];

$url = $base . '/v1/health';
if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 3,
        CURLOPT_CONNECTTIMEOUT => 2,
    ]);
    $raw = curl_exec($ch);
    $out['controller'] = [
        'via' => 'curl',
        'http' => (int) curl_getinfo($ch, CURLINFO_HTTP_CODE),
        'errno' => curl_errno($ch),
        'error' => curl_error($ch),
        'body' => is_string($raw) ? $raw : null,
    ];
    curl_close($ch);
} else {
    $raw = @file_get_contents($url, false, stream_context_create([
        'http' => ['timeout' => 3, 'ignore_errors' => true],
    ]));
    $status = 0;
    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
        $status = (int) $m[1];
    }
    $out['controller'] = [
        'via' => 'fopen',
        'http' => $status,
        'body' => is_string($raw) ? $raw : null,
        'note' => $raw === false ? 'fopen failed — enable allow_url_fopen or install php-curl' : null,
    ];
}

$c = $out['controller'];
$out['ok'] = is_array($c) && (int) ($c['http'] ?? 0) === 200;
http_response_code($out['ok'] ? 200 : 502);
echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
