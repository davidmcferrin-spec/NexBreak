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
    <div class="panel-head">
      <h2>Processing (inputs)</h2>
      <span id="proc-summary" class="panel-meta"></span>
    </div>
    <div id="proc-list"><div class="empty">Loading…</div></div>
  </div>
  <div class="panel">
    <h2>Egress (outputs)</h2>
    <div id="egr-list"><div class="empty">Loading…</div></div>
  </div>
</section>

<section class="panel" id="proc-editor" hidden>
  <h2>Edit processing channel</h2>
  <form id="proc-form" class="form-grid">
    <input type="hidden" name="id" id="p-id">
    <label>Name <input name="name" id="p-name" required></label>
    <label>Input type
      <select name="input_type" id="p-input_type">
        <option value="rtsp">RTSP</option>
        <option value="srt">SRT</option>
        <option value="decklink">DeckLink</option>
      </select>
    </label>

    <label class="proc-rtsp">RTSP role
      <select id="p-rtsp_role">
        <option value="client_pull">Client pull (we connect out)</option>
        <option value="server_push">Server push (they push to us)</option>
      </select>
    </label>
    <label class="proc-rtsp proc-rtsp-url">RTSP URL <input id="p-rtsp_url" placeholder="rtsp://host/stream"></label>
    <label class="proc-rtsp proc-rtsp-url">RTSP transport
      <select id="p-rtsp_transport">
        <option value="tcp">TCP</option>
        <option value="udp">UDP</option>
      </select>
    </label>

    <label class="proc-srt">SRT mode
      <select id="p-srt_mode">
        <option value="caller">Caller (we connect out)</option>
        <option value="listener">Listener (we accept)</option>
        <option value="rendezvous">Rendezvous</option>
      </select>
    </label>
    <label class="proc-srt">Paste srt:// URL
      <input id="p-srt_paste" placeholder="srt://10.68.183.33:9004" autocomplete="off">
    </label>
    <label class="proc-srt proc-srt-remote">Remote host <input id="p-srt_remote_host" placeholder="10.0.0.50"></label>
    <label class="proc-srt proc-srt-remote">Remote port <input type="number" id="p-srt_remote_port" min="1" max="65535"></label>
    <label class="proc-srt proc-srt-listen">Listen port <input type="number" id="p-srt_listen_port" min="1" max="65535"></label>

    <label class="proc-decklink">DeckLink device index <input type="number" id="p-decklink" min="0" step="1"></label>

    <label>Ingest mode
      <select id="p-ingest_mode">
        <option value="copy">Copy (remux)</option>
        <option value="transcode">Transcode</option>
      </select>
    </label>
    <label>Splice delay (ms) <input type="number" id="p-delay" min="0" step="100"></label>
    <label>SCTE-35 PID <input type="number" id="p-scte35_pid" min="16" max="8190" step="1" title="PMT stream type 0x86"></label>
    <label>Local feed port <input type="number" id="p-feed_port"></label>
    <div class="bitrate-readout" id="p-bitrate-box">
      <div class="muted" style="font-size:0.85rem;margin-bottom:4px">Bitrate (auto from live feed)</div>
      <div>Sensed input: <strong id="p-bitrate-sensed">—</strong> kbps</div>
      <div>Output target: <strong id="p-bitrate-out">—</strong> kbps <span class="muted">(+10 for captions)</span></div>
    </div>
    <input type="hidden" id="p-bitrate" value="">
    <label>Preview path <input id="p-preview_path" placeholder="nb1"></label>
    <label>Preview
      <select id="p-preview_enabled">
        <option value="1">On</option>
        <option value="0">Off</option>
      </select>
    </label>
    <label>Caption policy
      <select id="p-caption-policy">
        <option value="auto">Auto (preserve source CC, else ASR)</option>
        <option value="force_asr">Force ASR (H.264+CC override)</option>
        <option value="off">Off (no ASR; preserve source CC)</option>
      </select>
    </label>
    <label>Enabled
      <select id="p-enabled">
        <option value="1">Yes</option>
        <option value="0">No</option>
      </select>
    </label>
  </form>
  <p class="warn-banner" id="proc-rtsp-push-warn" hidden style="margin-top:10px">
    RTSP <code>server_push</code> needs an embedded RTSP server — not in v1 yet. Prefer <code>client_pull</code>.
  </p>
  <p class="warn-banner" style="margin-top:10px">
    Splice delay is the pre-roll wait before inject (restart <code>nexbreak-proc@N</code> after changing delay/PID).
    Roll buttons and panel URLs are configured on <a href="/triggers.php">Triggers</a>
    (<a href="/docs/panel-api.md">panel API</a> when served from the install tree).
  </p>
  <p class="warn-banner" style="margin-top:10px">
    Caption policy is hot: Off/Auto/Force ASR may restart this channel’s pipeline when the
    effective mode flips (preserve ↔ ASR insert). Force ASR re-encodes program video to H.264+CEA-608.
    Input URL / SRT / feed / preview path changes still need <code>nexbreak-proc@N</code> restart.
  </p>
  <div class="bar" style="margin-top:12px">
    <button type="button" class="primary" id="btn-proc-save">Save</button>
    <button type="button" id="btn-proc-cancel">Cancel</button>
  </div>
</section>

<section class="panel" id="egr-editor" hidden>
  <h2>Edit egress channel</h2>
  <form id="egr-form" class="form-grid">
    <input type="hidden" id="e-id">
    <label>Name <input id="e-name" required></label>
    <label>Output type
      <select id="e-output_type">
        <option value="srt">SRT</option>
        <option value="hls">HLS</option>
      </select>
    </label>
    <label class="egr-srt">SRT mode
      <select id="e-srt_mode">
        <option value="caller">Caller (we connect out)</option>
        <option value="listener">Listener (we accept)</option>
        <option value="rendezvous">Rendezvous</option>
      </select>
    </label>
    <label class="egr-srt egr-srt-remote">Remote host <input id="e-srt_remote_host" placeholder="10.0.0.50"></label>
    <label class="egr-srt egr-srt-remote">Remote port <input type="number" id="e-srt_remote_port" min="1" max="65535"></label>
    <label class="egr-srt egr-srt-listen">Listen port <input type="number" id="e-srt_listen_port" min="1" max="65535"></label>
    <label class="egr-hls">HLS mode
      <select id="e-hls_mode">
        <option value="origin_pull">Origin pull (we host)</option>
        <option value="push_put">Push PUT (remote ingest)</option>
      </select>
    </label>
    <label class="egr-hls egr-hls-push">Push URL <input id="e-hls_push_url" placeholder="https://cdn.example/ingest/…"></label>
    <div class="bitrate-readout" id="e-bitrate-box">
      <div class="muted" style="font-size:0.85rem;margin-bottom:4px">Bitrate (from routed input)</div>
      <div>Sensed input: <strong id="e-bitrate-sensed">—</strong> kbps</div>
      <div>Output target: <strong id="e-bitrate-out">—</strong> kbps <span class="muted">(+10 for captions)</span></div>
    </div>
    <input type="hidden" id="e-bitrate" value="">
    <label>Enabled
      <select id="e-enabled">
        <option value="1">Yes</option>
        <option value="0">No</option>
      </select>
    </label>
  </form>
  <p class="warn-banner" id="egr-hls-warn" hidden style="margin-top:10px">
    HLS egress is in the schema but not implemented in <code>nexbreak-egress</code> yet (v1 = SRT only).
  </p>
  <p class="warn-banner" style="margin-top:10px">
    After saving, restart <code>nexbreak-egress@N</code> (Services page) for transport changes to take effect.
  </p>
  <div class="bar" style="margin-top:12px">
    <button type="button" class="primary" id="btn-egr-save">Save</button>
    <button type="button" id="btn-egr-cancel">Cancel</button>
  </div>
</section>
<?php require __DIR__ . '/include/footer.php'; ?>
