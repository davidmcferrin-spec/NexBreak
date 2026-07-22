<?php
declare(strict_types=1);
$pageTitle = 'Channels';
$activeNav = 'channels';
$pageScript = '/assets/pages/channels.js';
require __DIR__ . '/include/header.php';
?>
<div class="page-header">
  <div>
    <h1>Channels</h1>
    <p class="sub">Processing inputs and egress destinations</p>
  </div>
  <button type="button" id="btn-refresh">Refresh</button>
</div>

<section class="two-col">
  <div class="panel">
    <h2>Processing (inputs)</h2>
    <div id="proc-list"><div class="empty">Loading…</div></div>
  </div>
  <div class="panel">
    <h2>Egress (outputs)</h2>
    <div id="egr-list"><div class="empty">Loading…</div></div>
  </div>
</section>

<section class="panel" id="editor" hidden>
  <h2>Edit processing channel</h2>
  <form id="proc-form" class="form-grid">
    <input type="hidden" name="id" id="f-id">
    <label>Name <input name="name" id="f-name" required></label>
    <label>Input type
      <select name="input_type" id="f-input_type">
        <option value="rtsp">RTSP</option>
        <option value="srt">SRT</option>
        <option value="decklink">DeckLink</option>
      </select>
    </label>
    <label>RTSP URL <input name="rtsp_url" id="f-rtsp_url"></label>
    <label>Splice delay (ms) <input type="number" name="splice_insertion_delay_ms" id="f-delay" min="0" step="100"></label>
    <label>Local feed port <input type="number" name="local_feed_port" id="f-feed_port"></label>
    <label>Target bitrate (kbps) <input type="number" name="target_bitrate_kbps" id="f-bitrate"></label>
    <label>Captioning
      <select name="captioning_enabled" id="f-captioning">
        <option value="0">Off</option>
        <option value="1">On</option>
      </select>
    </label>
    <label>Enabled
      <select name="enabled" id="f-enabled">
        <option value="1">Yes</option>
        <option value="0">No</option>
      </select>
    </label>
  </form>
  <div class="bar" style="margin-top:12px">
    <button type="button" class="primary" id="btn-save">Save</button>
    <button type="button" id="btn-cancel">Cancel</button>
  </div>
</section>
<?php require __DIR__ . '/include/footer.php'; ?>
