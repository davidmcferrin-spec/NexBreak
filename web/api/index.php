<?php
/**
 * Same-origin API proxy → nexbreak-controller (127.0.0.1:8787).
 *
 * Browser calls /api/v1/... ; this script forwards to the controller.
 * Avoids exposing :8787 and works without mod_proxy.
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/include/config.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$uri = $_SERVER['REQUEST_URI'] ?? '/api';
$path = parse_url($uri, PHP_URL_PATH) ?: '/api';

// Strip /api prefix → controller path (/v1/...)
if (str_starts_with($path, '/api')) {
    $path = substr($path, 4) ?: '/';
}
if ($path === '' || $path[0] !== '/') {
    $path = '/' . $path;
}

$query = parse_url($uri, PHP_URL_QUERY);
$target = nexbreak_api_base() . $path . ($query ? ('?' . $query) : '');

$headers = "Accept: application/json\r\n";
$body = null;
if (in_array($method, ['POST', 'PUT', 'PATCH'], true)) {
    $rawBody = file_get_contents('php://input');
    // Use === false so a body of "0" is not treated as empty (PHP falsy string).
    $body = ($rawBody === false) ? '' : $rawBody;
    $ct = $_SERVER['CONTENT_TYPE'] ?? 'application/json';
    $headers .= 'Content-Type: ' . $ct . "\r\n";
    $headers .= 'Content-Length: ' . strlen($body) . "\r\n";
}
if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
    $headers .= 'Authorization: ' . $_SERVER['HTTP_AUTHORIZATION'] . "\r\n";
}
if (!empty($_SERVER['HTTP_X_API_KEY'])) {
    $headers .= 'X-Api-Key: ' . $_SERVER['HTTP_X_API_KEY'] . "\r\n";
}

$opts = [
    'http' => [
        'method' => $method,
        'header' => $headers,
        'ignore_errors' => true,
        'timeout' => 90,
        'content' => $body,
    ],
];

$raw = @file_get_contents($target, false, stream_context_create($opts));
$status = 502;
$statusText = 'Bad Gateway';
if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s+(.*)$/', $http_response_header[0], $m)) {
    $status = (int) $m[1];
    $statusText = trim($m[2]);
}

header('Content-Type: application/json');
http_response_code($status);
echo $raw === false
    ? json_encode(['ok' => false, 'error' => 'controller unreachable at ' . nexbreak_api_base()])
    : $raw;
