<?php
declare(strict_types=1);
$pageTitle = 'Triggers';
$activeNav = 'triggers';
$pageScript = '/assets/pages/triggers.js';
require __DIR__ . '/include/header.php';
?>
<div class="page-header">
  <div>
    <h1>Triggers</h1>
    <p class="sub">Global SCTE-35 splice presets for Roll, StreamDeck, and DNF panels</p>
  </div>
  <div class="bar">
    <button type="button" class="primary" id="btn-new">New preset</button>
    <button type="button" id="btn-refresh">Refresh</button>
  </div>
</div>

<p class="warn-banner">
  Enabled presets appear as buttons on Roll for every channel.
  Panel URLs require <code>&amp;key=…</code> (12-char API key) — see <code>docs/panel-api.md</code>.
</p>

<section class="panel">
  <h2>Panel API key</h2>
  <p class="muted" style="margin-bottom:8px">
    Required on every splice. Copy into StreamDeck/DNF URLs, or use header
    <code>X-Api-Key</code>. Stored on the appliance (LAN trust).
  </p>
  <div class="bar" style="flex-wrap:wrap;align-items:center;gap:10px">
    <code id="panel-key-display" class="muted">Loading…</code>
    <button type="button" id="btn-copy-key">Copy key</button>
    <button type="button" id="btn-reveal-key" title="Show / hide key">Reveal</button>
    <button type="button" class="danger" id="btn-rotate-key" title="Invalidates old panel URLs">Rotate</button>
  </div>
</section>

<section class="panel">
  <h2>Presets</h2>
  <div id="preset-list"><div class="empty">Loading…</div></div>
</section>

<section class="panel" id="preset-editor" hidden>
  <h2 id="editor-title">Edit preset</h2>
  <form id="preset-form" class="form-grid">
    <input type="hidden" id="f-id">
    <label>Label <input id="f-label" required placeholder="ROLL"></label>
    <label>Slug <input id="f-slug" required placeholder="roll" pattern="[a-z0-9_]+" title="lowercase letters, digits, underscore"></label>
    <label>Sort order <input type="number" id="f-sort" value="100"></label>
    <label>Enabled
      <select id="f-enabled">
        <option value="1">Yes</option>
        <option value="0">No</option>
      </select>
    </label>
    <label>Splice type
      <select id="f-type">
        <option value="splice_start_immediate">Start immediate (out of network)</option>
        <option value="splice_start_normal">Start normal</option>
        <option value="splice_end_immediate">End immediate (return to network)</option>
        <option value="splice_end_normal">End normal</option>
        <option value="splice_cancel">Cancel</option>
      </select>
    </label>
    <label>Hex payload (optional — overrides type XML)
      <input id="f-hex" placeholder="leave blank for generated splice_insert">
    </label>
    <label>Auto-return
      <select id="f-auto">
        <option value="0">No</option>
        <option value="1">Yes (break_duration on start)</option>
      </select>
    </label>
    <label>Break duration (sec) <input type="number" id="f-break" min="0" step="0.1" placeholder="30"></label>
    <label>Use channel splice delay
      <select id="f-delay">
        <option value="1">Yes</option>
        <option value="0">No (inject immediately)</option>
      </select>
    </label>
  </form>
  <div class="bar" style="margin-top:12px">
    <button type="button" class="primary" id="btn-save">Save</button>
    <button type="button" id="btn-cancel">Cancel</button>
    <button type="button" class="danger" id="btn-delete" hidden>Delete</button>
  </div>
</section>

<section class="panel">
  <h2>Panel URL examples</h2>
  <p class="muted" style="margin-bottom:8px">
    Pick a channel — copy a GET URL (includes <code>&amp;key=</code>) onto a StreamDeck or DNF USP3-16 button.
  </p>
  <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
    Channel
    <select id="panel-channel" style="min-width:200px"></select>
  </label>
  <div id="panel-urls"><div class="empty">Load presets first</div></div>
</section>
<?php require __DIR__ . '/include/footer.php'; ?>
