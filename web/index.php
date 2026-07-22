<?php
declare(strict_types=1);
$pageTitle = 'Dashboard';
$activeNav = 'dashboard';
$pageScript = '/assets/pages/dashboard.js';
require __DIR__ . '/include/header.php';
?>
<div class="page-header">
  <div>
    <h1>Dashboard</h1>
    <p class="sub">Channel health, recent splices, and control-surface activity</p>
  </div>
  <div class="bar">
    <button type="button" id="btn-refresh">Refresh</button>
    <a class="primary" href="/roll.php" style="text-decoration:none;display:inline-flex;align-items:center;padding:7px 12px;border-radius:4px;background:var(--acc);color:var(--on-acc);font-weight:600;">Open Roll</a>
  </div>
</div>

<p class="warn-banner" id="api-status">Connecting to controller…</p>

<section class="grid-stats" id="stats">
  <div class="stat"><div class="k">Processing</div><div class="v" id="stat-proc">—</div></div>
  <div class="stat"><div class="k">Egress</div><div class="v" id="stat-egr">—</div></div>
  <div class="stat"><div class="k">Routes</div><div class="v" id="stat-routes">—</div></div>
  <div class="stat"><div class="k">Splice events</div><div class="v" id="stat-splices">—</div></div>
</section>

<section class="panel">
  <h2>Recent events</h2>
  <div id="recent-wrap">
    <div class="empty">Loading…</div>
  </div>
</section>
<?php require __DIR__ . '/include/footer.php'; ?>
