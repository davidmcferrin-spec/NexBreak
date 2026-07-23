<?php
/**
 * Shared page chrome — NexVUE-inspired dark ops console.
 *
 * Expects $pageTitle (string) and $activeNav (string) before include.
 * Optional: $pageScript (path under /assets/).
 */
declare(strict_types=1);

require_once __DIR__ . '/config.php';

$pageTitle = $pageTitle ?? 'NexBreak';
$activeNav = $activeNav ?? '';
$nav = [
    'dashboard' => ['href' => '/index.php', 'label' => 'Dashboard'],
    'roll' => ['href' => '/roll.php', 'label' => 'Roll'],
    'triggers' => ['href' => '/triggers.php', 'label' => 'Triggers'],
    'preview' => ['href' => '/preview.php', 'label' => 'Preview'],
    'channels' => ['href' => '/channels.php', 'label' => 'Channels'],
    'router' => ['href' => '/router.php', 'label' => 'Router'],
    'captions' => ['href' => '/captions.php', 'label' => 'Captions'],
    'verify' => ['href' => '/verify.php', 'label' => 'Verify'],
    'services' => ['href' => '/services.php', 'label' => 'Services'],
    'metrics' => ['href' => '/metrics.php', 'label' => 'Metrics'],
    'audit' => ['href' => '/audit.php', 'label' => 'Audit'],
];
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= htmlspecialchars($pageTitle, ENT_QUOTES, 'UTF-8') ?> — NexBreak</title>
<script src="<?= htmlspecialchars(nexbreak_asset('/assets/nexbreak-ui.js'), ENT_QUOTES, 'UTF-8') ?>"></script>
<link rel="stylesheet" href="<?= htmlspecialchars(nexbreak_asset('/assets/nexbreak.css'), ENT_QUOTES, 'UTF-8') ?>">
<script>
// Same-origin: browser → /api/* → PHP proxy → controller :8787
window.NEXBREAK_API = '/api';
window.NEXBREAK_WHEP_PORT = 8889;
</script>
<script src="<?= htmlspecialchars(nexbreak_asset('/assets/nexbreak-api.js'), ENT_QUOTES, 'UTF-8') ?>"></script>
<script src="<?= htmlspecialchars(nexbreak_asset('/assets/nexbreak-whep.js'), ENT_QUOTES, 'UTF-8') ?>"></script>
<script src="<?= htmlspecialchars(nexbreak_asset('/assets/nexbreak-cc.js'), ENT_QUOTES, 'UTF-8') ?>"></script>
</head>
<body>
<nav class="topnav" aria-label="Primary">
  <a class="brand" href="/index.php" id="brand">NexBreak</a>
  <?php foreach ($nav as $key => $item): ?>
    <a href="<?= htmlspecialchars($item['href'], ENT_QUOTES, 'UTF-8') ?>"
       class="<?= $activeNav === $key ? 'active' : '' ?>"><?= htmlspecialchars($item['label'], ENT_QUOTES, 'UTF-8') ?></a>
  <?php endforeach; ?>
  <button type="button" class="theme-toggle" id="theme-toggle" aria-pressed="false">Light</button>
</nav>
<main class="page">
