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
  <div class="bar">
    <button type="button" id="btn-cc" title="Show closed captions on previews">CC</button>
  </div>
</div>

<p class="warn-banner">Live WebRTC preview is post-splice. Buttons come from <a href="/triggers.php">Triggers</a> presets; each channel’s delay applies before inject.</p>

<section class="channel-grid" id="roll-grid">
  <div class="empty">Loading channels…</div>
</section>
<?php require __DIR__ . '/include/footer.php'; ?>
