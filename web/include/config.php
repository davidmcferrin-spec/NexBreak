<?php
/**
 * NexBreak web config — no Composer, plain PHP.
 */
declare(strict_types=1);

const NEXBREAK_ROOT = __DIR__ . '/..';

/** Controller API base (loopback). Override via Apache SetEnv NEXBREAK_API_BASE. */
function nexbreak_api_base(): string
{
    $env = $_SERVER['NEXBREAK_API_BASE'] ?? getenv('NEXBREAK_API_BASE');
    if (is_string($env) && $env !== '') {
        return rtrim($env, '/');
    }
    return 'http://127.0.0.1:8787';
}

/** SCTE Verify API (nexbreak-verify). Override via NEXBREAK_VERIFY_API_BASE. */
function nexbreak_verify_api_base(): string
{
    $env = $_SERVER['NEXBREAK_VERIFY_API_BASE'] ?? getenv('NEXBREAK_VERIFY_API_BASE');
    if (is_string($env) && $env !== '') {
        return rtrim($env, '/');
    }
    return 'http://127.0.0.1:8788';
}

function nexbreak_asset(string $path): string
{
    $path = '/' . ltrim($path, '/');
    $full = NEXBREAK_ROOT . $path;
    $v = is_file($full) ? (string) filemtime($full) : '1';
    return $path . '?v=' . rawurlencode($v);
}

/**
 * Server-side JSON fetch to the controller (for PHP pages that need data).
 * @return array{ok:bool,status:int,data:mixed}
 */
function nexbreak_api(string $method, string $path, ?array $body = null): array
{
    $url = nexbreak_api_base() . $path;
    $headers = "Accept: application/json\r\n";
    $opts = [
        'http' => [
            'method' => strtoupper($method),
            'header' => $headers,
            'ignore_errors' => true,
            'timeout' => 5,
        ],
    ];
    if ($body !== null) {
        $payload = json_encode($body, JSON_UNESCAPED_UNICODE);
        $opts['http']['header'] .= "Content-Type: application/json\r\n"
            . 'Content-Length: ' . strlen($payload) . "\r\n";
        $opts['http']['content'] = $payload;
    }
    $raw = @file_get_contents($url, false, stream_context_create($opts));
    $status = 0;
    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
        $status = (int) $m[1];
    }
    $data = $raw !== false ? json_decode($raw, true) : null;
    return [
        'ok' => $status >= 200 && $status < 300,
        'status' => $status,
        'data' => $data,
    ];
}
