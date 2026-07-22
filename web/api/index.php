<?php
/**
 * Same-origin API proxy → nexbreak-controller (127.0.0.1:8787).
 *
 * Browser calls /api/v1/... ; this script forwards to the controller.
 * Prefer curl (works when allow_url_fopen is Off). Never leak a PHP 500 —
 * failures return JSON with 502.
 */
declare(strict_types=1);

// Catch fatals into JSON so the UI can show a useful message.
register_shutdown_function(static function (): void {
    $err = error_get_last();
    if ($err === null) {
        return;
    }
    $fatal = [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR];
    if (!in_array($err['type'], $fatal, true)) {
        return;
    }
    if (headers_sent()) {
        return;
    }
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode([
        'ok' => false,
        'error' => 'api proxy fatal: ' . $err['message'],
        'file' => basename($err['file'] ?? ''),
        'line' => $err['line'] ?? 0,
    ]);
});

try {
    require_once dirname(__DIR__) . '/include/config.php';

    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $uri = $_SERVER['REQUEST_URI'] ?? '/api';
    $path = parse_url($uri, PHP_URL_PATH);
    if (!is_string($path) || $path === '') {
        $path = '/api';
    }

    // Strip /api prefix → controller path (/v1/...)
    // Also handle /nexbreak/api/... if the app is in a subdirectory.
    if (preg_match('#/api(/.*)?$#', $path, $m)) {
        $path = $m[1] ?? '/';
        if ($path === '') {
            $path = '/';
        }
    } elseif (str_starts_with($path, '/api')) {
        $path = substr($path, 4);
        if ($path === '' || $path === false) {
            $path = '/';
        }
    }
    if ($path === '' || $path[0] !== '/') {
        $path = '/' . ltrim((string) $path, '/');
    }

    $query = parse_url($uri, PHP_URL_QUERY);
    $target = nexbreak_api_base() . $path . (is_string($query) && $query !== '' ? ('?' . $query) : '');

    $body = null;
    $sendBody = in_array($method, ['POST', 'PUT', 'PATCH'], true);
    if ($sendBody) {
        $rawBody = file_get_contents('php://input');
        $body = ($rawBody === false) ? '' : $rawBody;
    }

    $reqHeaders = [
        'Accept: application/json',
    ];
    if ($sendBody) {
        $ct = $_SERVER['CONTENT_TYPE'] ?? 'application/json';
        $reqHeaders[] = 'Content-Type: ' . $ct;
        $reqHeaders[] = 'Content-Length: ' . strlen($body ?? '');
    }
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
        $reqHeaders[] = 'Authorization: ' . $_SERVER['HTTP_AUTHORIZATION'];
    }
    if (!empty($_SERVER['HTTP_X_API_KEY'])) {
        $reqHeaders[] = 'X-Api-Key: ' . $_SERVER['HTTP_X_API_KEY'];
    }

    $result = nexbreak_proxy_request($method, $target, $reqHeaders, $sendBody ? $body : null);

    header('Content-Type: application/json');
    http_response_code($result['status']);
    echo $result['body'];
} catch (Throwable $e) {
    if (!headers_sent()) {
        header('Content-Type: application/json');
        http_response_code(500);
    }
    echo json_encode([
        'ok' => false,
        'error' => 'api proxy exception: ' . $e->getMessage(),
    ]);
}

/**
 * @param list<string> $headers
 * @return array{status:int,body:string}
 */
function nexbreak_proxy_request(string $method, string $url, array $headers, ?string $body): array
{
    // Prefer curl — works with allow_url_fopen=Off (common on hardened hosts).
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        if ($ch === false) {
            return nexbreak_proxy_fail('curl_init failed', $url);
        }
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => false,
            CURLOPT_TIMEOUT => 90,
            CURLOPT_CONNECTTIMEOUT => 5,
            // Controller is loopback HTTP only.
            CURLOPT_FOLLOWLOCATION => false,
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $raw = curl_exec($ch);
        $errno = curl_errno($ch);
        $err = curl_error($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($raw === false || $errno !== 0) {
            return nexbreak_proxy_fail(
                'controller unreachable via curl: ' . ($err !== '' ? $err : 'errno ' . $errno),
                $url
            );
        }
        if ($status < 100) {
            $status = 502;
        }
        return ['status' => $status, 'body' => $raw];
    }

    // Fallback: fopen http wrapper
    $headerBlob = implode("\r\n", $headers) . "\r\n";
    $opts = [
        'http' => [
            'method' => $method,
            'header' => $headerBlob,
            'ignore_errors' => true,
            'timeout' => 90,
        ],
    ];
    if ($body !== null) {
        $opts['http']['content'] = $body;
    }

    $raw = @file_get_contents($url, false, stream_context_create($opts));
    $status = 502;
    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
        $status = (int) $m[1];
    }
    if ($raw === false) {
        return nexbreak_proxy_fail(
            'controller unreachable (allow_url_fopen may be Off; install php-curl)',
            $url
        );
    }
    return ['status' => $status, 'body' => $raw];
}

/**
 * @return array{status:int,body:string}
 */
function nexbreak_proxy_fail(string $message, string $url): array
{
    return [
        'status' => 502,
        'body' => json_encode([
            'ok' => false,
            'error' => $message,
            'target' => $url,
        ], JSON_UNESCAPED_SLASHES) ?: '{"ok":false,"error":"proxy fail"}',
    ];
}
