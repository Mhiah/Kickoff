"""A small builder that turns logic into a TapeOut circuit made only of NAND gates.

TapeOut circuits are lists of NAND gates (TAP-02, "Circuit Netlist Format and Evaluation
Semantics"). This file lets the scoring rules be written with ordinary logic words (and, or,
equal, greater than) and then writes them out as NAND gates in TapeOut's byte format.

It only builds. It does not check anything. Checking is done separately, on the finished bytes,
by check.py, with two evaluators that share no code with this file.

Signal numbering (TAP-02 section 2):
    0            the constant 0
    1            the constant 1
    2 .. 2+nIn-1 the inputs, input i at index 2 + i
    after that   one new signal for each gate, in the order the gates are written
"""
from __future__ import annotations

ZERO, ONE = 0, 1
NAND_OPCODE = 0x00


class Net:
    """A circuit under construction."""

    def __init__(self, n_in: int):
        self.n_in = n_in
        self._gates: list[tuple[int, int]] = []          # gate k is signal 2 + n_in + k
        self._seen: dict[tuple[int, int], int] = {}      # reuse a gate that already exists
        self._outputs: list[int] = []

    # ---- the one real gate ----

    def inp(self, i: int) -> int:
        if not 0 <= i < self.n_in:
            raise ValueError(f"input {i} out of range")
        return 2 + i

    def _first_gate(self) -> int:
        return 2 + self.n_in

    def _gate_ins(self, s: int) -> tuple[int, int] | None:
        k = s - self._first_gate()
        return self._gates[k] if k >= 0 else None

    def _is_not_of(self, s: int) -> int | None:
        """If signal s is a NOT gate, return the signal it inverts."""
        g = self._gate_ins(s)
        return g[0] if g is not None and g[0] == g[1] else None

    def _new_gate(self, a: int, b: int) -> int:
        self._gates.append((a, b))
        return self._first_gate() + len(self._gates) - 1

    def nand(self, a: int, b: int) -> int:
        # Simplify where the answer is already known, so no gate is wasted.
        if a == ZERO or b == ZERO:
            return ONE
        if a == ONE and b == ONE:
            return ZERO
        if a == ONE:
            a = b
        elif b == ONE:
            b = a
        if a == b:
            inner = self._is_not_of(a)
            if inner is not None:
                return inner                              # NOT(NOT x) is x
        elif self._is_not_of(a) == b or self._is_not_of(b) == a:
            return ONE                                    # NAND(x, NOT x) is always 1
        key = (a, b) if a <= b else (b, a)
        if key not in self._seen:
            self._seen[key] = self._new_gate(*key)
        return self._seen[key]

    # ---- ordinary logic, all made from NAND ----

    def not_(self, a: int) -> int:
        return self.nand(a, a)

    def and_(self, *xs: int) -> int:
        out = xs[0]
        for x in xs[1:]:
            out = self.not_(self.nand(out, x))
        return out

    def or_(self, *xs: int) -> int:
        out = xs[0]
        for x in xs[1:]:
            out = self.nand(self.not_(out), self.not_(x))
        return out

    def xor(self, a: int, b: int) -> int:
        t = self.nand(a, b)
        return self.nand(self.nand(a, t), self.nand(b, t))

    def same_bit(self, a: int, b: int) -> int:
        return self.not_(self.xor(a, b))

    def same(self, xs: list[int], ys: list[int]) -> int:
        """1 when two numbers are equal. Lists are lowest bit first."""
        return self.and_(*[self.same_bit(x, y) for x, y in zip(xs, ys)])

    def greater(self, xs: list[int], ys: list[int]) -> int:
        """1 when number xs is bigger than number ys. Lists are lowest bit first."""
        result = ZERO
        for x, y in zip(xs, ys):                          # from the lowest bit up
            x_wins_here = self.and_(x, self.not_(y))
            result = self.or_(x_wins_here, self.and_(self.same_bit(x, y), result))
        return result

    # ---- finishing ----

    def set_outputs(self, signals: list[int]) -> None:
        """TAP-02 says the outputs are the last gates written, in order. So each output gets its
        own final gate, written last, that repeats the value it should carry."""
        for s in signals:
            self._outputs.append(self._new_gate(self.not_(s), self.not_(s)))

    def netlist(self) -> tuple[bytes, int]:
        """Return (the circuit in TapeOut's byte format, how many gates it has).

        Gates that nothing depends on are left out, then the rest are renumbered."""
        if not self._outputs:
            raise ValueError("no outputs set")
        first = self._first_gate()
        keep: set[int] = set()
        todo = list(self._outputs)
        while todo:
            s = todo.pop()
            if s < first or s in keep:
                continue
            keep.add(s)
            todo.extend(self._gates[s - first])
        new_index: dict[int, int] = {}
        out = bytearray()
        for k, (a, b) in enumerate(self._gates):
            s = first + k
            if s not in keep:
                continue
            new_index[s] = first + len(new_index)
            out.append(NAND_OPCODE)
            for src in (a, b):
                out += new_index.get(src, src).to_bytes(3, "big")
        # The outputs must be the very last signals, in the order they were set.
        expected = list(range(first + len(new_index) - len(self._outputs), first + len(new_index)))
        if [new_index[s] for s in self._outputs] != expected:
            raise AssertionError("outputs are not the last gates")
        return bytes(out), len(new_index)
