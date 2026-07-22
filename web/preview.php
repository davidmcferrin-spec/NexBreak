<?php
declare(strict_types=1);
$pageTitle = 'Preview';
$activeNav = 'preview';
$pageScript = '/assets/pages/preview.js';
require __DIR__ . '/include/header.php';
?>
<div class="page-header">
  <div>
    <h1>Preview</h1>
    <p class="sub">Low-latency WebRTC (WHEP) — post-splice processed feed via MediaMTX</p>
  </div>
  <div class="bar">
    <button type="button" id="btn-cc" title="Show closed captions on previews">CC</button>
    <button type="button" id="btn-refresh">Refresh</button>
    <span class="muted" id="whep-hint"></span>
  </div>
</div>

<p class="warn-banner">Requires <code>nexbreak-mediamtx</code> and a running <code>nexbreak-proc@N</code> with preview enabled. Firewall: TCP 8889 + UDP/TCP 8189.</p>

<section class="channel-grid" id="preview-grid">
  <div class="empty">Loading…</div>
</section>
<?php require __DIR__ . '/include/footer.php'; ?>
