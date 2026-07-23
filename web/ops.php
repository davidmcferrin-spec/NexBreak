<?php
/**
 * nexbreak-ops.php — JSON API for Services page (systemd status / journal / lifecycle).
 *
 * Phase 1 LAN-trust: no auth. Privileged work goes through allowlisted sudo
 * wrappers only (see config/nexbreak-ops.sudoers).
 *
 * Actions: services | journal | journal_clear | restart | restart_channels | set_enabled | set_running
 */
declare(strict_types=1);

const SUDO = '/usr/bin/sudo';

function fail(int $status, string $message): never
{
    if (!headers_sent()) {
        header('Content-Type: application/json');
        header('Cache-Control: no-store');
    }
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $message]);
    exit;
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function unit_allowed(string $unit): bool
{
    return (bool) preg_match(
        '/^(nexbreak-controller|nexbreak-mediamtx|nexbreak-proc@[0-9]|nexbreak-egress@[0-9])$/',
        $unit
    );
}

function unit_enable_allowed(string $unit): bool
{
    return (bool) preg_match('/^(nexbreak-proc@[0-9]|nexbreak-egress@[0-9])$/', $unit);
}

function parse_unit_status_line(string $line): ?array
{
    $parts = preg_split('/\s+/', trim($line));
    if ($parts === false || count($parts) < 3) {
        return null;
    }
    return [
        'unit' => $parts[0],
        'state' => $parts[1],
        'enabled' => $parts[2],
    ];
}

function sudo_run(array $argv, ?string $stdin = null): array
{
    $cmd = [SUDO, '-n'];
    foreach ($argv as $a) {
        $cmd[] = $a;
    }
    $descriptors = [
        0 => ['pipe', 'r'],
        1 => ['pipe', 'w'],
        2 => ['pipe', 'w'],
    ];
    $proc = proc_open($cmd, $descriptors, $pipes, null, null, ['bypass_shell' => true]);
    if (!is_resource($proc)) {
        fail(500, 'failed to start privileged helper');
    }
    if ($stdin !== null) {
        fwrite($pipes[0], $stdin);
    }
    fclose($pipes[0]);
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $code = proc_close($proc);
    return ['code' => $code, 'stdout' => (string) $stdout, 'stderr' => (string) $stderr];
}

/** Fixed ops inventory — no controller round-trip (keeps Services snappy). */
function list_ops_units(): array
{
    $units = ['nexbreak-controller', 'nexbreak-mediamtx'];
    for ($i = 1; $i <= 4; $i++) {
        $units[] = "nexbreak-proc@{$i}";
        $units[] = "nexbreak-egress@{$i}";
    }
    return $units;
}

function controller_get(string $path): ?array
{
    $url = 'http://127.0.0.1:8787' . $path;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 1,
            CURLOPT_TIMEOUT => 2,
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
        ]);
        $raw = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($raw === false || $code < 200 || $code >= 300) {
            return null;
        }
    } else {
        $ctx = stream_context_create(['http' => ['timeout' => 2, 'ignore_errors' => true]]);
        $raw = @file_get_contents($url, false, $ctx);
        if ($raw === false) {
            return null;
        }
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : null;
}

/** Channel template instances from controller DB (for restart_channels only). */
function list_channel_units(): array
{
    $units = [];
    $proc = controller_get('/v1/processing');
    $egr = controller_get('/v1/egress');
    if (is_array($proc) && !empty($proc['channels'])) {
        foreach ($proc['channels'] as $ch) {
            $sn = (string) ($ch['service_name'] ?? '');
            if ($sn !== '' && preg_match('/^[0-9]$/', $sn)) {
                $units[] = "nexbreak-proc@{$sn}";
            }
        }
    }
    if (is_array($egr) && !empty($egr['channels'])) {
        foreach ($egr['channels'] as $ch) {
            $sn = (string) ($ch['service_name'] ?? '');
            if ($sn !== '' && preg_match('/^[0-9]$/', $sn)) {
                $units[] = "nexbreak-egress@{$sn}";
            }
        }
    }
    if ($units === []) {
        for ($i = 1; $i <= 4; $i++) {
            $units[] = "nexbreak-proc@{$i}";
            $units[] = "nexbreak-egress@{$i}";
        }
    }
    return $units;
}

function batch_unit_status(array $units): array
{
    if ($units === []) {
        return [];
    }
    $argv = array_merge(['/usr/local/bin/nexbreak-ops-status.sh'], array_values($units));
    $r = sudo_run($argv);
    $byUnit = [];
    foreach (preg_split("/\r\n|\n|\r/", trim($r['stdout'])) as $line) {
        if ($line === '') {
            continue;
        }
        $st = parse_unit_status_line($line);
        if ($st === null) {
            continue;
        }
        $byUnit[$st['unit']] = $st;
    }
    $items = [];
    foreach ($units as $unit) {
        $st = $byUnit[$unit] ?? ['unit' => $unit, 'state' => 'unknown', 'enabled' => 'unknown'];
        $items[] = [
            'unit' => $unit,
            'state' => $st['state'],
            'enabled' => $st['enabled'],
            'can_toggle' => unit_enable_allowed($unit),
            'ok' => ($st['state'] === 'active'),
        ];
    }
    return $items;
}

header('Content-Type: application/json');
header('Cache-Control: no-store');

$body = read_json_body();
$action = $_GET['action'] ?? ($body['action'] ?? '');
if (!is_string($action) || $action === '') {
    fail(400, 'action required');
}

if ($action === 'services') {
    echo json_encode(['ok' => true, 'services' => batch_unit_status(list_ops_units())]);
    exit;
}

if ($action === 'journal') {
    $unit = $body['unit'] ?? ($_GET['unit'] ?? '');
    $lines = (int) ($body['lines'] ?? ($_GET['lines'] ?? 100));
    $since = $body['since'] ?? ($_GET['since'] ?? '');
    if (!is_string($unit) || !unit_allowed($unit)) {
        fail(400, 'invalid unit');
    }
    $lines = max(1, min(500, $lines));
    $argv = ['/usr/local/bin/nexbreak-ops-journal.sh', $unit, (string) $lines];
    if (is_string($since) && $since !== '') {
        $argv[] = $since;
    }
    $r = sudo_run($argv);
    if ($r['code'] !== 0) {
        fail(500, trim($r['stderr']) !== '' ? trim($r['stderr']) : 'journalctl failed');
    }
    echo json_encode(['ok' => true, 'unit' => $unit, 'log' => $r['stdout']]);
    exit;
}

if ($action === 'journal_clear') {
    // Rotates + vacuums the whole host journal (systemd has no per-unit delete).
    $r = sudo_run(['/usr/local/bin/nexbreak-ops-journal-clear.sh']);
    if ($r['code'] !== 0) {
        fail(500, trim($r['stderr']) !== '' ? trim($r['stderr']) : 'journal clear failed');
    }
    echo json_encode([
        'ok' => true,
        'detail' => 'journal rotated and vacuumed (host-wide)',
        'stdout' => $r['stdout'],
    ]);
    exit;
}

if ($action === 'restart') {
    $units = $body['units'] ?? [];
    if (!is_array($units) || $units === []) {
        fail(400, 'units required');
    }
    foreach ($units as $u) {
        if (!is_string($u) || !unit_allowed($u)) {
            fail(400, 'invalid unit');
        }
    }
    $argv = array_merge(['/usr/local/bin/nexbreak-ops-restart.sh'], $units);
    $r = sudo_run($argv);
    if ($r['code'] !== 0) {
        fail(500, trim($r['stderr']) !== '' ? trim($r['stderr']) : 'restart failed');
    }
    echo json_encode(['ok' => true, 'restarted' => array_values($units)]);
    exit;
}

if ($action === 'restart_channels') {
    // Restart every enabled proc/egress instance (not controller/mediamtx).
    $channelUnits = list_channel_units();
    $targets = [];
    foreach (batch_unit_status($channelUnits) as $st) {
        if (($st['enabled'] ?? '') === 'enabled') {
            $targets[] = $st['unit'];
        }
    }
    if ($targets === []) {
        echo json_encode(['ok' => true, 'restarted' => [], 'note' => 'no enabled channel units']);
        exit;
    }
    $argv = array_merge(['/usr/local/bin/nexbreak-ops-restart.sh'], $targets);
    $r = sudo_run($argv);
    if ($r['code'] !== 0) {
        fail(500, trim($r['stderr']) !== '' ? trim($r['stderr']) : 'restart failed');
    }
    echo json_encode(['ok' => true, 'restarted' => $targets]);
    exit;
}

if ($action === 'set_enabled' || $action === 'set_running') {
    $unit = $body['unit'] ?? '';
    $enable = $body['enable'] ?? $body['run'] ?? null;
    if (!is_string($unit) || !unit_enable_allowed($unit)) {
        fail(400, 'invalid unit (proc/egress only)');
    }
    if ($enable === null) {
        fail(400, 'enable/run required');
    }
    $on = in_array($enable, [true, 1, '1', 'true', 'on'], true);
    if ($action === 'set_enabled') {
        $verb = $on ? 'enable' : 'disable';
    } else {
        $verb = $on ? 'start' : 'stop';
    }
    $r = sudo_run(['/usr/local/bin/nexbreak-ops-enable.sh', $verb, $unit]);
    if ($r['code'] !== 0) {
        fail(500, trim($r['stderr']) !== '' ? trim($r['stderr']) : "{$verb} failed");
    }
    echo json_encode(['ok' => true, 'unit' => $unit, 'action' => $verb]);
    exit;
}

fail(400, 'unknown action');
