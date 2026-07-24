<?php
declare(strict_types=1);
$pageTitle = 'About';
$activeNav = 'about';
require __DIR__ . '/include/header.php';
?>
<div class="page-header">
  <div>
    <h1>About NexBreak</h1>
    <p class="sub">Broadcast splice control, captions, and software routing</p>
  </div>
</div>

<section class="panel">
  <h2>What this system is</h2>
  <p>
    NexBreak ingests up to four independent video streams (RTSP, SRT, or DeckLink SDI-in),
    inserts operator-controlled SCTE-35 splice markers, can add live closed captions
    (ASR), and routes each processed feed to SRT or HLS egress. Each input and each
    output runs as its own systemd service so a fault on one channel cannot take down
    another.
  </p>
  <p class="about-meta">
    Control surfaces: web UI (Roll, Channels, Triggers), StreamDeck / DNF panel HTTP,
    and a LAN-trust REST API. Verify watches the return feed for SCTE sightings.
  </p>
</section>

<section class="panel">
  <h2>Open source &amp; components</h2>
  <p class="muted" style="margin:0 0 12px">
    NexBreak itself is the application glue (Apache/PHP UI, Python services, SQLite).
    Media and signaling lean on these projects:
  </p>
  <div class="about-stack">
    <div>
      <strong>TSDuck</strong> —
      <a href="https://tsduck.io/" target="_blank" rel="noopener">tsduck.io</a>
      · MPEG-TS toolkit used for SCTE-35 <code>spliceinject</code> / monitoring
    </div>
    <div>
      <strong>FFmpeg</strong> —
      <a href="https://ffmpeg.org/" target="_blank" rel="noopener">ffmpeg.org</a>
      · Ingest, remux/transcode, HLS packaging, preview encode paths
    </div>
    <div>
      <strong>MediaMTX</strong> —
      <a href="https://github.com/bluenviron/mediamtx" target="_blank" rel="noopener">github.com/bluenviron/mediamtx</a>
      · Low-latency WebRTC (WHEP) preview publisher
    </div>
    <div>
      <strong>Vosk</strong> —
      <a href="https://alphacephei.com/vosk/" target="_blank" rel="noopener">alphacephei.com/vosk</a>
      · Offline ASR for live captioning (when policy requires insert)
    </div>
    <div>
      <strong>Live Caption Encoder</strong> (vendored) —
      CEA-608 A/53 inject into the program feed (<code>cc_injector</code>)
    </div>
    <div>
      <strong>Apache HTTP Server + PHP</strong> —
      Web UI and same-origin API proxy (no Node.js / Composer)
    </div>
    <div>
      <strong>Python 3 (stdlib)</strong> —
      Controller, proc, egress, verify, metrics sampler
    </div>
    <div>
      <strong>SQLite</strong> —
      Config, routing, audit, host metric history
    </div>
    <div>
      <strong>libsrt / SRT</strong> —
      Contribution and distribution transport (via TSDuck / FFmpeg)
    </div>
  </div>
  <p class="about-meta">
    Respect each project’s license when redistributing. System packages on Ubuntu
    (ffmpeg, apache2, php, python3) are installed via apt; TSDuck and MediaMTX follow
    the NexBreak install script.
  </p>
</section>

<section class="panel">
  <h2>Ops &amp; support</h2>
  <ul>
    <li><a href="/services.php">Services</a> — unit status, journals, support bundle zip</li>
    <li><a href="/metrics.php">Metrics</a> — host CPU/mem/swap/GPU history + splice activity</li>
    <li><a href="/triggers.php">Triggers</a> — splice presets and panel API key</li>
    <li><a href="/verify.php">Verify</a> — SCTE return-feed monitor</li>
  </ul>
  <p class="about-meta">
    On-host docs: <code>docs/support-bundle.md</code>, <code>docs/panel-api.md</code>, <code>CLAUDE.md</code>.
  </p>
</section>
<?php require __DIR__ . '/include/footer.php'; ?>
