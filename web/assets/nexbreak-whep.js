/**
 * nexbreak-whep.js — low-latency WebRTC preview via MediaMTX WHEP.
 * Pattern adapted from NexVUE index.html (recvonly, playoutDelayHint=0).
 *
 * Usage:
 *   var player = NexBreakWHEP.create(videoEl, { path: "nb1", onState: fn });
 *   player.connect();
 *   player.disconnect();
 */
(function (global) {
  "use strict";

  function whepBase(port) {
    port = port || 8889;
    var proto = global.location.protocol === "https:" ? "https:" : "http:";
    return proto + "//" + global.location.hostname + ":" + port;
  }

  function create(videoEl, opts) {
    opts = opts || {};
    var path = opts.path;
    var port = opts.whepPort || 8889;
    var onState = opts.onState || function () {};
    var onStream = opts.onStream || function () {};
    var pc = null;
    var intentional = false;
    var reconnectTimer = null;
    var attempt = 0;

    function setState(msg, kind) {
      onState({ message: msg, kind: kind || "", path: path });
    }

    function closePc() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (pc) {
        try {
          pc.close();
        } catch (e) {}
        pc = null;
      }
      if (videoEl) videoEl.srcObject = null;
      try {
        onStream(null, null);
      } catch (e) {}
    }

    function scheduleReconnect(reason) {
      if (intentional || !path) return;
      attempt += 1;
      var wait = Math.min(10000, 1000 * Math.pow(1.5, Math.min(attempt, 8)));
      setState("reconnecting in " + Math.round(wait / 1000) + "s (" + reason + ")", "bad");
      reconnectTimer = setTimeout(function () {
        connect();
      }, wait);
    }

    async function connect() {
      if (!path) {
        setState("no preview path", "bad");
        return;
      }
      intentional = false;
      closePc();
      setState("connecting " + path + "…", "");

      var url = whepBase(port) + "/" + encodeURIComponent(path) + "/whep";
      pc = new RTCPeerConnection();
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
      pc.ontrack = function (ev) {
        try {
          ev.receiver.playoutDelayHint = 0;
        } catch (e) {}
        try {
          ev.receiver.jitterBufferTarget = 0;
        } catch (e) {}
        if (!videoEl) return;
        // Video and audio often arrive as separate ontrack events; merge into one MediaStream
        // so unmute actually has an audio track (common WHEP/MediaMTX pitfall).
        var stream = videoEl.srcObject;
        if (!(stream instanceof MediaStream)) {
          stream = ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream();
          videoEl.srcObject = stream;
        }
        if (ev.track && stream.getTracks().indexOf(ev.track) === -1) {
          stream.addTrack(ev.track);
        }
        videoEl.play().catch(function () {});
        try {
          onStream(stream, ev.track);
        } catch (e) {}
      };
      pc.onconnectionstatechange = function () {
        if (!pc) return;
        if (pc.connectionState === "connected") {
          attempt = 0;
          setState("live " + path, "ok");
        } else if (
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected" ||
          pc.connectionState === "closed"
        ) {
          setState(pc.connectionState, "bad");
          if (!intentional) scheduleReconnect(pc.connectionState);
        }
      };

      try {
        var offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await new Promise(function (resolve) {
          if (pc.iceGatheringState === "complete") return resolve();
          var check = function () {
            if (pc.iceGatheringState === "complete") {
              pc.removeEventListener("icegatheringstatechange", check);
              resolve();
            }
          };
          pc.addEventListener("icegatheringstatechange", check);
          setTimeout(resolve, 2000);
        });

        var res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: pc.localDescription.sdp,
        });
        if (!res.ok) throw new Error("WHEP HTTP " + res.status);
        await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
      } catch (err) {
        var msg = err && err.message ? err.message : String(err);
        setState("error: " + msg, "bad");
        closePc();
        if (!intentional) scheduleReconnect(msg);
      }
    }

    function disconnect() {
      intentional = true;
      closePc();
      setState("idle", "");
    }

    function setPath(newPath) {
      path = newPath;
    }

    return {
      connect: connect,
      disconnect: disconnect,
      setPath: setPath,
      whepBase: function () {
        return whepBase(port);
      },
    };
  }

  global.NexBreakWHEP = {
    create: create,
    whepBase: whepBase,
  };
})(typeof window !== "undefined" ? window : globalThis);
