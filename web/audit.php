<?php
declare(strict_types=1);
$pageTitle = 'Audit';
$activeNav = 'audit';
$pageScript = '/assets/pages/audit.js';
require __DIR__ . '/include/header.php';
?>
<div class="page-header">
  <div>
    <h1>Audit</h1>
    <p class="sub">Splice commands, service lifecycle, config and routing changes</p>
  </div>
  <button type="button" id="btn-refresh">Refresh</button>
</div>

<section class="panel">
  <h2>Event log</h2>
  <div id="audit-wrap"><div class="empty">Loading…</div></div>
</section>
<?php require __DIR__ . '/include/footer.php'; ?>
