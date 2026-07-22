<?php
declare(strict_types=1);
$pageTitle = 'Router';
$activeNav = 'router';
$pageScript = '/assets/pages/router.js';
require __DIR__ . '/include/header.php';
?>
<div class="page-header">
  <div>
    <h1>Router</h1>
    <p class="sub">Assign processed feeds to egress adapters — not fixed 1-in / 1-out</p>
  </div>
  <button type="button" id="btn-refresh">Refresh</button>
</div>

<section class="panel">
  <h2>Routing matrix</h2>
  <div class="router-matrix" id="matrix">
    <div class="empty">Loading…</div>
  </div>
</section>
<?php require __DIR__ . '/include/footer.php'; ?>
