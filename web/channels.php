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
    <p class="sub">Processing inputs, egress destinations, and which input feeds each output</p>
  </div>
  <button type="button" id="btn-refresh">Refresh</button>
</div>

<p class="warn-banner">
  Source on an egress picks which processing feed it reads. Changes apply within ~1s
  (egress rebuilds the push automatically — no unit restart). Matching colors link
  each input to the outputs it feeds.
</p>

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

<!-- Processing edit modal -->
<div id="proc-modal" class="nb-modal" hidden>
  <div class="nb-modal-backdrop" data-close-proc tabindex="-1"></div>
  <div class="nb-modal-card" role="dialog" aria-modal="true" aria-labelledby="proc-modal-title">
    <header class="nb-modal-head">
      <div>
        <h2 id="proc-modal-title">Edit processing</h2>
        <p class="muted nb-modal-sub" id="proc-modal-sub"></p>
      </div>
      <button type="button" class="nb-modal-x" data-close-proc aria-label="Close">&times;</button>
    </header>
    <div class="nb-modal-body">
      <form id="proc-form" class="modal-form" autocomplete="off">
        <input type="hidden" name="id" id="p-id">

        <fieldset class="field-section">
          <legend>Basics</legend>
          <div class="form-grid">
            <label class="field" data-help="Display name in Roll, Verify, and Audit.">
              <span class="field-label">Name</span>
              <input name="name" id="p-name" required>
            </label>
            <label class="field" data-help="When No, the channel stays configured but should stay stopped/disabled for day-to-day ops.">
              <span class="field-label">Enabled</span>
              <select id="p-enabled">
                <option value="1">Yes</option>
                <option value="0">No</option>
              </select>
            </label>
            <label class="field" data-help="How this channel receives video. Changing type shows only the fields that apply.">
              <span class="field-label">Input type</span>
              <select name="input_type" id="p-input_type">
                <option value="rtsp">RTSP</option>
                <option value="srt">SRT</option>
                <option value="decklink">DeckLink</option>
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset class="field-section proc-rtsp">
          <legend>RTSP source</legend>
          <div class="form-grid">
            <label class="field" data-help="Client pull: we connect out to the camera/encoder (normal). Server push needs an embedded RTSP server — not in v1 yet.">
              <span class="field-label">RTSP role</span>
              <select id="p-rtsp_role">
                <option value="client_pull">Client pull (we connect out)</option>
                <option value="server_push">Server push (they push to us)</option>
              </select>
            </label>
            <label class="field proc-rtsp-url" data-help="Full rtsp:// URL of the source. Pasting an srt:// URL auto-switches input type to SRT.">
              <span class="field-label">RTSP URL</span>
              <input id="p-rtsp_url" placeholder="rtsp://host/stream">
            </label>
            <label class="field proc-rtsp-url" data-help="TCP is more reliable through firewalls. UDP can be lower latency on clean LANs.">
              <span class="field-label">RTSP transport</span>
              <select id="p-rtsp_transport">
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
              </select>
            </label>
          </div>
          <p class="warn-banner" id="proc-rtsp-push-warn" hidden>
            RTSP <code>server_push</code> needs an embedded RTSP server — not in v1 yet. Prefer <code>client_pull</code>.
          </p>
        </fieldset>

        <fieldset class="field-section proc-srt">
          <legend>SRT source</legend>
          <div class="form-grid">
            <label class="field" data-help="Caller: we dial the remote. Listener: we accept inbound. Rendezvous: both sides dial.">
              <span class="field-label">SRT mode</span>
              <select id="p-srt_mode">
                <option value="caller">Caller (we connect out)</option>
                <option value="listener">Listener (we accept)</option>
                <option value="rendezvous">Rendezvous</option>
              </select>
            </label>
            <label class="field" data-help="Paste srt://host:port[?mode=…] to fill host/port/mode in one step.">
              <span class="field-label">Paste srt:// URL</span>
              <input id="p-srt_paste" placeholder="srt://10.68.183.33:9004" autocomplete="off">
            </label>
            <label class="field proc-srt-remote" data-help="Remote SRT host for caller or rendezvous.">
              <span class="field-label">Remote host</span>
              <input id="p-srt_remote_host" placeholder="10.0.0.50">
            </label>
            <label class="field proc-srt-remote" data-help="Remote SRT port for caller or rendezvous.">
              <span class="field-label">Remote port</span>
              <input type="number" id="p-srt_remote_port" min="1" max="65535">
            </label>
            <label class="field proc-srt-listen" data-help="Local UDP port we listen on for inbound SRT callers.">
              <span class="field-label">Listen port</span>
              <input type="number" id="p-srt_listen_port" min="1" max="65535">
            </label>
          </div>
        </fieldset>

        <fieldset class="field-section proc-decklink">
          <legend>DeckLink</legend>
          <div class="form-grid">
            <label class="field" data-help="Blackmagic DeckLink device index (0 = first card/port as seen by the driver).">
              <span class="field-label">Device index</span>
              <input type="number" id="p-decklink" min="0" step="1">
            </label>
          </div>
        </fieldset>

        <fieldset class="field-section">
          <legend>Pipeline &amp; SCTE</legend>
          <div class="form-grid">
            <label class="field" data-help="Copy remuxes without re-encoding (lowest CPU). Transcode re-encodes when the source format needs normalization.">
              <span class="field-label">Ingest mode</span>
              <select id="p-ingest_mode">
                <option value="copy">Copy (remux)</option>
                <option value="transcode">Transcode</option>
              </select>
            </label>
            <label class="field" data-help="Elementary PID for SCTE-35 (PMT stream type 0x86). Default 500. Restart proc after changing.">
              <span class="field-label">SCTE-35 PID</span>
              <input type="number" id="p-scte35_pid" min="16" max="8190" step="1">
            </label>
            <label class="field" data-help="Local MPEG-TS UDP port for this channel’s processed feed (egress / preview / Verify tap). Usually 19001–19004.">
              <span class="field-label">Local feed port</span>
              <input type="number" id="p-feed_port">
            </label>
          </div>
          <div class="offset-slider" id="p-delay-wrap" data-help="Left = hold video (splice earlier; adds feed latency). Center = 0. Right = hold trigger (splice later). ~33 ms ≈ 1 frame @29.97. Negative values restart the pipeline on save.">
            <div class="offset-slider-head">
              <span class="field-label">Splice timing offset</span>
              <strong id="p-delay-value">0 ms</strong>
            </div>
            <div class="offset-slider-labels" aria-hidden="true">
              <span>−2s video hold</span>
              <span>0</span>
              <span>+2s trigger hold</span>
            </div>
            <input type="range" id="p-delay" min="-2000" max="2000" step="33" value="0"
              aria-valuemin="-2000" aria-valuemax="2000" aria-valuenow="0"
              aria-label="Splice timing offset from minus 2 seconds video hold to plus 2 seconds trigger hold">
            <p class="muted field-hint" id="p-delay-hint">Drag left to hold video · center = no offset · right to hold trigger</p>
          </div>
          <div class="bitrate-readout" id="p-bitrate-box">
            <div class="muted" style="font-size:0.85rem;margin-bottom:4px">Bitrate (auto from live feed)</div>
            <div>Sensed input: <strong id="p-bitrate-sensed">—</strong> kbps</div>
            <div>Output target: <strong id="p-bitrate-out">—</strong> kbps <span class="muted">(+10 for captions)</span></div>
          </div>
          <input type="hidden" id="p-bitrate" value="">
        </fieldset>

        <fieldset class="field-section">
          <legend>Preview &amp; captions</legend>
          <div class="form-grid">
            <label class="field" data-help="MediaMTX path for WebRTC/WHEP preview (e.g. nb1). Must be unique per channel.">
              <span class="field-label">Preview path</span>
              <input id="p-preview_path" placeholder="nb1">
            </label>
            <label class="field" data-help="When Off, this channel does not publish a live preview.">
              <span class="field-label">Preview</span>
              <select id="p-preview_enabled">
                <option value="1">On</option>
                <option value="0">Off</option>
              </select>
            </label>
            <label class="field" data-help="Auto: preserve source CEA when present, else ASR. Force ASR: always insert CEA-608 (H.264 re-encode). Off: no ASR; still remux-preserves source CC. Policy flips can restart the pipeline.">
              <span class="field-label">Caption policy</span>
              <select id="p-caption-policy">
                <option value="auto">Auto (preserve source CC, else ASR)</option>
                <option value="force_asr">Force ASR (H.264+CC override)</option>
                <option value="off">Off (no ASR; preserve source CC)</option>
              </select>
            </label>
          </div>
        </fieldset>
      </form>
      <p class="warn-banner muted-note">
        Ingest URL / SRT / feed / preview path changes need <code>nexbreak-proc@N</code> restart (Services).
        Roll buttons live on <a href="/triggers.php">Triggers</a>.
      </p>
    </div>
    <footer class="nb-modal-foot">
      <button type="button" id="btn-proc-cancel" data-close-proc>Cancel</button>
      <button type="button" class="primary" id="btn-proc-save">Save</button>
    </footer>
  </div>
</div>

<!-- Egress edit modal -->
<div id="egr-modal" class="nb-modal" hidden>
  <div class="nb-modal-backdrop" data-close-egr tabindex="-1"></div>
  <div class="nb-modal-card" role="dialog" aria-modal="true" aria-labelledby="egr-modal-title">
    <header class="nb-modal-head">
      <div>
        <h2 id="egr-modal-title">Edit egress</h2>
        <p class="muted nb-modal-sub" id="egr-modal-sub"></p>
      </div>
      <button type="button" class="nb-modal-x" data-close-egr aria-label="Close">&times;</button>
    </header>
    <div class="nb-modal-body">
      <form id="egr-form" class="modal-form" autocomplete="off">
        <input type="hidden" id="e-id">
        <input type="hidden" id="e-service_name" value="">
        <input type="hidden" id="e-bitrate" value="">

        <fieldset class="field-section">
          <legend>Basics</legend>
          <div class="form-grid">
            <label class="field" data-help="Display name in Verify and Services.">
              <span class="field-label">Name</span>
              <input id="e-name" required>
            </label>
            <label class="field" data-help="When No, this destination should stay stopped.">
              <span class="field-label">Enabled</span>
              <select id="e-enabled">
                <option value="1">Yes</option>
                <option value="0">No</option>
              </select>
            </label>
            <label class="field" data-help="SRT is the v1 delivery path. HLS origin_pull hosts an M3U8 on this appliance; push_put is not implemented yet.">
              <span class="field-label">Output type</span>
              <select id="e-output_type">
                <option value="srt">SRT</option>
                <option value="hls">HLS</option>
              </select>
            </label>
            <label class="field" data-help="Which processing input’s post-splice feed this egress delivers. Same assignment as the Source column in the egress list — no separate Router page.">
              <span class="field-label">Source (input)</span>
              <select id="e-source"></select>
            </label>
          </div>
        </fieldset>

        <fieldset class="field-section egr-srt">
          <legend>SRT destination</legend>
          <div class="form-grid">
            <label class="field" data-help="Listener: players dial us. Caller: we dial a remote ingest. Rendezvous: both sides dial.">
              <span class="field-label">SRT mode</span>
              <select id="e-srt_mode">
                <option value="caller">Caller (we connect out)</option>
                <option value="listener">Listener (we accept)</option>
                <option value="rendezvous">Rendezvous</option>
              </select>
            </label>
            <label class="field egr-srt-remote" data-help="Remote SRT host for caller or rendezvous.">
              <span class="field-label">Remote host</span>
              <input id="e-srt_remote_host" placeholder="10.0.0.50">
            </label>
            <label class="field egr-srt-remote" data-help="Remote SRT port for caller or rendezvous.">
              <span class="field-label">Remote port</span>
              <input type="number" id="e-srt_remote_port" min="1" max="65535">
            </label>
            <label class="field egr-srt-listen" data-help="Local port clients dial as SRT callers (VLC, CDN, etc.).">
              <span class="field-label">Listen port</span>
              <input type="number" id="e-srt_listen_port" min="1" max="65535">
            </label>
          </div>
        </fieldset>

        <fieldset class="field-section egr-hls">
          <legend>HLS destination</legend>
          <div class="form-grid">
            <label class="field" data-help="Origin pull: we host the playlist under /hls/&lt;svc&gt;/. Push PUT: we push segments to a remote ingest (not implemented yet).">
              <span class="field-label">HLS mode</span>
              <select id="e-hls_mode">
                <option value="origin_pull">Origin pull (we host)</option>
                <option value="push_put">Push PUT (remote ingest)</option>
              </select>
            </label>
            <label class="field egr-hls-push" data-help="Remote HTTP(S) ingest URL for push_put mode.">
              <span class="field-label">Push URL</span>
              <input id="e-hls_push_url" placeholder="https://cdn.example/ingest/…">
            </label>
          </div>
          <p class="warn-banner" id="egr-hls-warn" hidden>
            HLS <strong>push_put</strong> is not implemented yet. Use <strong>origin_pull</strong> or switch back to SRT.
          </p>
        </fieldset>

        <div class="egr-client-url field-section" id="egr-client-url" hidden>
          <label class="field" for="e-client-url" data-help="Ready-to-paste URL for VLC or a CDN. Hostname comes from this browser’s address bar.">
            <span class="field-label">Client URL (VLC / CDN)</span>
          </label>
          <div class="bar" style="margin-top:4px">
            <input id="e-client-url" readonly style="flex:1;min-width:12rem" spellcheck="false">
            <button type="button" id="btn-egr-copy-url">Copy</button>
          </div>
          <p class="muted" id="e-client-url-hint" style="margin:6px 0 0;font-size:12px"></p>
        </div>

        <div class="bitrate-readout" id="e-bitrate-box">
          <div class="muted" style="font-size:0.85rem;margin-bottom:4px">Bitrate (from routed input)</div>
          <div>Sensed input: <strong id="e-bitrate-sensed">—</strong> kbps</div>
          <div>Output target: <strong id="e-bitrate-out">—</strong> kbps <span class="muted">(+10 for captions)</span></div>
        </div>
      </form>
      <p class="warn-banner muted-note">
        After saving, restart <code>nexbreak-egress@N</code> on Services for transport changes to take effect.
      </p>
    </div>
    <footer class="nb-modal-foot">
      <button type="button" id="btn-egr-cancel" data-close-egr>Cancel</button>
      <button type="button" class="primary" id="btn-egr-save">Save</button>
    </footer>
  </div>
</div>

<div id="field-tip" class="field-tip" hidden role="tooltip"></div>
<?php require __DIR__ . '/include/footer.php'; ?>
