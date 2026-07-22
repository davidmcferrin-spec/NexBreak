<?php
declare(strict_types=1);
$pageTitle = 'Metrics';
$activeNav = 'metrics';
$pageScript = '/assets/pages/metrics.js';
require __DIR__ . '/include/header.php';
?>
<div class="page-header">
  <div>
    <h1>Metrics</h1>
    <p class="sub">Splice / config / routing activity from the audit log — not viewer analytics</p>
  </div>
  <div class="bar">
    <span class="muted">range:</span>
    <button type="button" class="range" data-range="15m">15m</button>
    <button type="button" class="range" data-range="1h">1h</button>
    <button type="button" class="range" data-range="6h">6h</button>
    <button type="button" class="range active" data-range="24h">24h</button>
    <button type="button" class="range" data-range="7d">7d</button>
    <button type="button" id="btn-refresh">Refresh</button>
    <span id="state" class="muted"></span>
  </div>
</div>

<section class="grid-stats" id="totals">
  <div class="stat"><div class="k">Splices</div><div class="v" id="m-splices">—</div></div>
  <div class="stat"><div class="k">Splice OK</div><div class="v ok" id="m-ok">—</div></div>
  <div class="stat"><div class="k">Splice fail</div><div class="v" id="m-fail">—</div></div>
  <div class="stat"><div class="k">Routing</div><div class="v" id="m-routes">—</div></div>
  <div class="stat"><div class="k">Config</div><div class="v" id="m-config">—</div></div>
  <div class="stat"><div class="k">Lifecycle</div><div class="v" id="m-life">—</div></div>
</section>

<section class="panel">
  <h2>Splice activity</h2>
  <p class="muted" style="margin:0 0 8px;font-size:12px">Success (green) vs failure (red) per time bucket</p>
  <div id="chart-splices" class="spark-chart" aria-label="Splice activity chart"></div>
</section>

<div class="two-col">
  <section class="panel">
    <h2>Per processing channel</h2>
    <div id="by-channel"><div class="empty">Loading…</div></div>
  </section>
  <section class="panel">
    <h2>Routing snapshot</h2>
    <div id="routes"><div class="empty">Loading…</div></div>
  </section>
</div>

<section class="panel">
  <h2>Channel inventory</h2>
  <div id="inventory"><div class="empty">Loading…</div></div>
</section>
<?php require __DIR__ . '/include/footer.php'; ?>
