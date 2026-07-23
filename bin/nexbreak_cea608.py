#!/usr/bin/env python3
"""
Minimal CEA-608 CC1 encoder + ATSC A/53 SEI (ITU-T T.35) for H.264 Annex B.

Stdlib only. Produces field-1 cc_data pairs suitable for closed caption CC1.
"""

from __future__ import annotations

from typing import Iterable, List, Sequence, Tuple

# Basic North American caption characters (ASCII subset used on-air).
_CHAR_MAP = {i: i for i in range(0x20, 0x7F)}
_CHAR_MAP.update(
    {
        ord("'"): 0x27,
        ord('"'): 0x22,
        ord("—"): 0x2D,
        ord("–"): 0x2D,
        ord("…"): 0x2E,
    }
)

# CC1 preamble: row 14 white (pop-on/paint-on style roll-up base).
# Using roll-up 2 + carriage return style for live ASR.
_RU2 = (0x14, 0x25)  # roll-up captions-2 rows, CC1
_CR = (0x14, 0x2D)  # carriage return
_EDM = (0x14, 0x2C)  # erase displayed memory
_ENM = (0x14, 0x2E)  # erase non-displayed
_EOC = (0x14, 0x2F)  # end of caption (display)
_TO1 = (0x17, 0x21)  # tab offset 1 (unused mostly)


def _odd_parity(b: int) -> int:
    b &= 0x7F
    ones = bin(b).count("1")
    return b if (ones % 2) == 1 else (b | 0x80)


def cc_pair(d1: int, d2: int) -> Tuple[int, int]:
    return _odd_parity(d1), _odd_parity(d2)


def encode_chars(text: str) -> List[Tuple[int, int]]:
    """Encode text into CEA-608 character pairs (CC1)."""
    pairs: List[Tuple[int, int]] = []
    buf: List[int] = []
    for ch in text:
        o = ord(ch)
        if ch in "\r\n":
            if buf:
                if len(buf) == 1:
                    pairs.append(cc_pair(buf[0], 0x00))
                buf = []
            continue
        mapped = _CHAR_MAP.get(o)
        if mapped is None:
            if o > 127:
                continue
            mapped = 0x3F  # ?
        if 0x20 <= mapped <= 0x7F:
            buf.append(mapped)
            if len(buf) == 2:
                pairs.append(cc_pair(buf[0], buf[1]))
                buf = []
    if len(buf) == 1:
        pairs.append(cc_pair(buf[0], 0x00))
    elif len(buf) == 2:
        pairs.append(cc_pair(buf[0], buf[1]))
    return pairs


def text_to_cc_pairs(text: str, *, clear: bool = False) -> List[Tuple[int, int]]:
    """
    Build a short CC1 sequence for live paint/roll-up style display.
    clear=True emits erase codes only.
    """
    out: List[Tuple[int, int]] = []
    out.append(cc_pair(*_EDM))
    if clear or not (text or "").strip():
        return out
    clean = " ".join((text or "").replace("\n", " ").split())
    if len(clean) > 64:
        clean = clean[:61] + "..."
    out.append(cc_pair(*_RU2))
    out.extend(encode_chars(clean))
    out.append(cc_pair(*_CR))
    return out


def null_pad_pairs(pairs: Sequence[Tuple[int, int]], count: int) -> List[Tuple[int, int]]:
    """Pad/truncate to exactly `count` pairs (null = 0x80,0x80 with parity)."""
    null = cc_pair(0x00, 0x00)
    seq = list(pairs)[:count]
    while len(seq) < count:
        seq.append(null)
    return seq


def build_a53_cc_payload(pairs: Sequence[Tuple[int, int]]) -> bytes:
    """
    ATSC A/53 user_data() for CEA-608/708 wrapper with process_cc_data_flag=1.
    Each pair is one cc_data_pkt for NTSC field 1 (cc_type=0).
    """
    pkts = list(pairs)
    if not pkts:
        pkts = [cc_pair(0x00, 0x00)]
    # Max 31 packets per A/53 structure
    pkts = pkts[:31]
    cc_count = len(pkts)
    # reserved(1)='1' process_em(1)=0 process_cc(1)=1 additional(1)=0 cc_count(5)
    b0 = 0x80 | 0x40 | (cc_count & 0x1F)
    body = bytearray([b0, 0xFF])  # em_data = 0xFF when not processing
    for d1, d2 in pkts:
        # marker(5)=0x1F, cc_valid=1, cc_type=0 (field1)
        one = 0xFC  # 111111 + valid + type00 → actually: marker_bits(5) | cc_valid(1) | cc_type(2)
        # marker_bits = 0b11111, cc_valid=1, cc_type=00 → 0b11111_1_00 = 0xFC
        body.append(one)
        body.append(d1 & 0xFF)
        body.append(d2 & 0xFF)
    # markerbits trailing
    body.append(0xFF)
    return bytes(body)


def build_itu_t35_sei_payload(a53_user_data: bytes) -> bytes:
    """
    SEI payload type 4: user_data_registered_itu_t_t35 wrapping GA94 A/53.
    """
    # ATSC country code / provider
    # country_code = 0xB5 (United States)
    # provider_code = 0x0031
    # user_identifier = 'GA94'
    # user_data_type_code = 0x03
    return (
        bytes([0xB5, 0x00, 0x31])
        + b"GA94"
        + bytes([0x03])
        + a53_user_data
    )


def rbsp_trailing(payload: bytes) -> bytes:
    return payload + bytes([0x80])


def encode_sei_nal(sei_payload_type: int, sei_payload: bytes) -> bytes:
    """Build a single SEI NAL unit (Annex B without start code)."""
    # payloadType / payloadSize in 255-chunk encoding
    def _ff_encode(n: int) -> bytes:
        out = bytearray()
        while n >= 255:
            out.append(255)
            n -= 255
        out.append(n)
        return bytes(out)

    rbsp = _ff_encode(sei_payload_type) + _ff_encode(len(sei_payload)) + sei_payload
    rbsp = rbsp_trailing(rbsp)
    # Prevent emulation: insert 0x03 before 00 00 00|01|02|03 in RBSP
    emulated = bytearray()
    zeros = 0
    for b in rbsp:
        if zeros >= 2 and b <= 0x03:
            emulated.append(0x03)
            zeros = 0
        emulated.append(b)
        zeros = zeros + 1 if b == 0 else 0
    nal_header = bytes([0x06])  # nal_unit_type=6 SEI, nal_ref_idc=0
    return nal_header + bytes(emulated)


def annex_b_sei_nal(pairs: Sequence[Tuple[int, int]]) -> bytes:
    """Full Annex-B SEI NAL with 4-byte start code for CC pairs."""
    a53 = build_a53_cc_payload(pairs)
    itu = build_itu_t35_sei_payload(a53)
    nal = encode_sei_nal(4, itu)
    return b"\x00\x00\x00\x01" + nal


def iter_caption_sei_units(text: str, *, clear: bool = False, pairs_per_sei: int = 3) -> Iterable[bytes]:
    """Yield Annex-B SEI NALs covering the caption text."""
    pairs = text_to_cc_pairs(text, clear=clear)
    if not pairs:
        pairs = [cc_pair(0x00, 0x00)]
    for i in range(0, len(pairs), pairs_per_sei):
        chunk = pairs[i : i + pairs_per_sei]
        yield annex_b_sei_nal(chunk)
