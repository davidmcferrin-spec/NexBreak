<?php
declare(strict_types=1);
$pageTitle = 'Roll';
$activeNav = 'roll';
$pageScript = '/assets/pages/roll.js';
require __DIR__ . '/include/header.php';
?>
<div class="page-header">
  <div>
    <h1>Roll</h1>
    <p class="sub">Per-stream SCTE-35 splice control — one channel never touches another</p>
  </div>
</div>

<p class="warn-banner">Roll applies the channel's splice delay, then injects SCTE-35 via TSDuck on that stream only.</p>

<section class="channel-grid" id="roll-grid">
  <div class="empty">Loading channels…</div>
</section>
<?php require __DIR__ . '/include/footer.php'; ?>
