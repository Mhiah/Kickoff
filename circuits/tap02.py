"""Kickoff's own reader for TapeOut circuits (TAP-02), written separately from the builder.

It takes the finished bytes of a circuit, checks they are a well-formed TapeOut circuit, and works
out the outputs for a given set of inputs, the same way a TapeOut processor's eval() does.

Kickoff's circuits use NAND gates only. A circuit that contains anything else is refused here.
"""
from __future__ import annotations

NAND_OPCODE = 0x00
RECORD_BYTES = 7                       # one opcode byte, then two 3-byte signal numbers


class BadCircuit(ValueError):
    pass


def read(data: bytes, n_in: int, n_out: int) -> list[tuple[int, int]]:
    """Check the circuit is well formed (TAP-02 section 3) and return its gates."""
    if len(data) % RECORD_BYTES:
        raise BadCircuit("the last gate is cut short")
    gates = []
    for k in range(len(data) // RECORD_BYTES):
        record = data[k * RECORD_BYTES:(k + 1) * RECORD_BYTES]
        if record[0] != NAND_OPCODE:
            raise BadCircuit(f"gate {k} is not a NAND gate")
        a = int.from_bytes(record[1:4], "big")
        b = int.from_bytes(record[4:7], "big")
        this_signal = 2 + n_in + k
        if a >= this_signal or b >= this_signal:
            raise BadCircuit(f"gate {k} uses a signal that does not exist yet")
        gates.append((a, b))
    if not 1 <= n_out <= len(gates):
        raise BadCircuit("too few gates for the outputs")
    return gates


def evaluate(gates: list[tuple[int, int]], n_in: int, n_out: int, inputs: bytes) -> bytes:
    """One evaluation: packed inputs in, packed outputs out (TAP-02 sections 4 and 5)."""
    signals = [0, 1] + unpack(inputs, n_in)
    for a, b in gates:
        signals.append(1 - (signals[a] & signals[b]))
    return pack(signals[len(signals) - n_out:])


def pack(bit_list: list[int]) -> bytes:
    """Lowest bit first: bit i goes into byte i // 8 at position i % 8."""
    out = bytearray((len(bit_list) + 7) // 8)
    for i, value in enumerate(bit_list):
        if value:
            out[i >> 3] |= 1 << (i & 7)
    return bytes(out)


def unpack(data: bytes, n: int) -> list[int]:
    """Missing bytes read as 0, extra ones are ignored, as the deployed contracts do."""
    return [(data[i >> 3] >> (i & 7)) & 1 if (i >> 3) < len(data) else 0 for i in range(n)]
