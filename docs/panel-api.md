# NexBreak panel API (StreamDeck / DNF USP3-16)

LAN-trust control surface for SCTE-35 splice inject. Same endpoints power the
web **Roll** page and hardware panels.

Base URL (Apache same-origin):

```text
http://<nexbreak-host>/api
```

Loopback (from the host itself):

```text
http://127.0.0.1:8787
```

## API key (required for splice)

Every `/v1/splice` call (GET or POST) must present a **12-character** panel key
(`[A-Za-z0-9]`). Accept any one of:

| Mechanism | Example |
|---|---|
| Query | `?key=Ab12Cd34Ef56` |
| Header | `X-Api-Key: Ab12Cd34Ef56` |
| Bearer | `Authorization: Bearer Ab12Cd34Ef56` |
| JSON body | `{"key":"Ab12Cd34Ef56", …}` (POST) |

Missing/invalid key → **HTTP 401**. Other control routes (config, presets,
Verify) stay open on the trusted LAN; only splice fire is gated.

The controller mints the key on first boot into `control_credentials` (hash +
plaintext for panel URL copy) and writes a sidecar
`panel-api.key` next to the SQLite DB. Manage it in **Triggers → Panel API
key** (reveal / copy / rotate). Audit rows set `triggered_by_credential_id`.

```http
GET  /api/v1/credentials/panel          # reveal current key (LAN)
POST /api/v1/credentials/panel/rotate   # requires current key; mints new
```

---

## Fire a splice

### Preferred: named preset (Triggers library)

Presets are configured in the web **Triggers** page (`/triggers.php`).
Enabled presets become Roll buttons and panel URLs.

**GET** (DNF USP3-16 / StreamDeck HTTP request actions that only GET):

```http
GET /api/v1/splice?processing_channel_id=1&preset=roll&key=Ab12Cd34Ef56
```

**POST** (JSON + header):

```http
POST /api/v1/splice
Content-Type: application/json
X-Api-Key: Ab12Cd34Ef56

{"processing_channel_id": 1, "preset": "roll"}
```

Also accepted: `"preset_id": 1` instead of `"preset": "roll"`.

### Legacy: raw splice_type / hex

```http
POST /api/v1/splice
Content-Type: application/json
X-Api-Key: Ab12Cd34Ef56

{
  "processing_channel_id": 1,
  "splice_type": "splice_start_immediate",
  "hex_payload": null,
  "auto_return": false,
  "break_duration_sec": null,
  "use_channel_delay": true
}
```

`splice_type` values:

| Value | Meaning |
|---|---|
| `splice_start_immediate` | Out of network, `splice_immediate=true` |
| `splice_start_normal` | Out of network, `splice_immediate=false` |
| `splice_end_immediate` | Return to network, immediate |
| `splice_end_normal` | Return to network, normal |
| `splice_cancel` | Cancel outstanding event (no channel delay) |

When `hex_payload` is set, raw bytes are sent to TSDuck `spliceinject` and the
XML type is ignored.

### Response (HTTP 202 on success)

```json
{
  "ok": true,
  "audit_id": 42,
  "event_id": 7,
  "delay_ms": 2000,
  "splice_type": "splice_start_immediate",
  "message": "xml event_id=7 → udp/20001",
  "preset": {"id": 1, "slug": "roll", "label": "ROLL"}
}
```

`delay_ms` is the positive (trigger-hold) portion of the per-channel timing
offset (`splice_insertion_delay_ms`, clamped ±2000 ms) unless the preset sets
`use_channel_delay=0` or the type is `splice_cancel`. Positive values sleep
before inject; negative values hold the video in the tsp chain via timeshift
(so the splice can land earlier relative to what the operator saw) and do not
extend this response wait.

---

## StreamDeck

1. Create an **HTTP Request** action (or similar) per button.
2. Method **GET**, URL from Triggers → Panel URL examples, e.g.

   `http://sctetest/api/v1/splice?processing_channel_id=1&preset=roll&key=Ab12Cd34Ef56`

3. One button per channel × preset (Input 1 ROLL, Input 1 END, …).
4. After **Rotate** on Triggers, re-copy every button URL.

---

## DNF USP3-16

Configure each physical button as HTTP GET/POST to the same URLs.
No vendor SDK — plain HTTP.

Example mapping:

| Button | URL |
|---|---|
| CH1 ROLL | `…/api/v1/splice?processing_channel_id=1&preset=roll&key=…` |
| CH1 END | `…/api/v1/splice?processing_channel_id=1&preset=end&key=…` |
| CH1 CANCEL | `…/api/v1/splice?processing_channel_id=1&preset=cancel&key=…` |

---

## Preset CRUD

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/splice/presets` | `?enabled=1` for Roll-only |
| GET | `/v1/splice/presets/{id}` | One preset |
| POST | `/v1/splice/presets` | Create |
| POST | `/v1/splice/presets/{id}` | Update |
| POST | `/v1/splice/presets/{id}` | `{"delete": true}` to remove |

Fields: `slug`, `label`, `sort_order`, `enabled`, `splice_type`, `hex_payload`,
`auto_return`, `break_duration_sec`, `use_channel_delay`.

---

## Confirm inject (Verify)

1. Open **Verify**, select the egress routed from that input, **Listen**.
2. Status should show **listening** then **stream locked** with rising bytes.
3. Fire a splice from Roll/panel.
4. **Recent injects** lists controller audit rows (`event_id`, delay, result).
5. **SCTE sightings** lists bitstream detections from `tsp` (`tid 0xFC`).
   A **matched** badge means the sighting’s `event_id` lined up with audit.

```http
GET /api/v1/verify/egresses
POST /api/v1/verify/1/listen
GET /api/v1/verify/1/live
GET /api/v1/audit?event_type=splice_command&limit=20
```

---

## Curl smoke tests

```bash
# Show / mint panel key
KEY=$(curl -sS http://127.0.0.1:8787/v1/credentials/panel | python3 -c 'import sys,json; print(json.load(sys.stdin)["api_key"])')

# List presets
curl -sS http://127.0.0.1:8787/v1/splice/presets | python3 -m json.tool

# Fire ROLL on channel 1 (GET + query key)
curl -sS "http://127.0.0.1:8787/v1/splice?processing_channel_id=1&preset=roll&key=$KEY"

# Same via header
curl -sS -H "X-Api-Key: $KEY" \
  'http://127.0.0.1:8787/v1/splice?processing_channel_id=1&preset=end'

# Fire via Apache proxy
curl -sS "http://127.0.0.1/api/v1/splice?processing_channel_id=1&preset=end&key=$KEY"

# Recent splice audit
curl -sS 'http://127.0.0.1:8787/v1/audit?event_type=splice_command&limit=10'
```
