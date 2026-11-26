"""Builds Kickoff's scoring circuits and writes them to circuits/out/.

Run from the repository root:

    python3 circuits/build.py

Every circuit has two outputs. Read together they are the points for one pick:

    output 0   1 when the pick scores at least 1 point
    output 1   1 when the pick scores the full 3 points

    points = output 0 + 2 x output 1      so the only possible totals are 0, 1 and 3

A rule that only ever gives 1 point (Result, Goal Goal) keeps output 1 at 0. A rule that only ever
gives 3 (Exact score) sets both outputs together.

What goes into each circuit, bit by bit, is listed in circuits/README.md.
"""
from __future__ import annotations

import hashlib
import json
import pathlib

from gates import ZERO, Net

OUT = pathlib.Path(__file__).parent / "out"


def bits(net: Net, start: int, count: int) -> list[int]:
    """`count` input bits starting at `start`, lowest bit first."""
    return [net.inp(start + i) for i in range(count)]


def football() -> Net:
    """Inputs (16): your home goals, your away goals, real home goals, real away goals.
    Four bits each, so 0 to 15 goals."""
    net = Net(16)
    my_home, my_away = bits(net, 0, 4), bits(net, 4, 4)
    real_home, real_away = bits(net, 8, 4), bits(net, 12, 4)

    exact = net.and_(net.same(my_home, real_home), net.same(my_away, real_away))

    # A result is one of three things: home win, draw, away win. Two facts pin it down:
    # "did home score more?" and "was it level?". Two results match when both facts match.
    my_home_win, my_level = net.greater(my_home, my_away), net.same(my_home, my_away)
    real_home_win, real_level = net.greater(real_home, real_away), net.same(real_home, real_away)
    right_result = net.and_(
        net.same_bit(my_home_win, real_home_win),
        net.same_bit(my_level, real_level),
    )

    net.set_outputs([right_result, exact])
    return net


def result() -> Net:
    """Football, the Result prediction. Inputs (10): your result (2 bits: 0 home, 1 draw, 2 away),
    real home goals, real away goals (4 bits each). 1 point for the right result. A "3" in the two
    result bits is not a prediction and scores 0."""
    net = Net(10)
    low, high = net.inp(0), net.inp(1)
    real_home, real_away = bits(net, 2, 4), bits(net, 6, 4)

    said_home = net.and_(net.not_(low), net.not_(high))
    said_draw = net.and_(low, net.not_(high))
    said_away = net.and_(net.not_(low), high)

    home_win, level = net.greater(real_home, real_away), net.same(real_home, real_away)
    away_win = net.and_(net.not_(home_win), net.not_(level))

    right = net.or_(net.and_(said_home, home_win), net.and_(said_draw, level), net.and_(said_away, away_win))

    net.set_outputs([right, ZERO])
    return net


def goalgoal() -> Net:
    """Football, the Goal Goal prediction. Inputs (9): your answer (1 bit: 1 means both sides
    score), real home goals, real away goals (4 bits each). 1 point for the right answer."""
    net = Net(9)
    said_both = net.inp(0)
    real_home, real_away = bits(net, 1, 4), bits(net, 5, 4)

    both_scored = net.and_(net.or_(*real_home), net.or_(*real_away))

    net.set_outputs([net.same_bit(said_both, both_scored), ZERO])
    return net


def score() -> Net:
    """Football, the Exact score prediction. Inputs (16), laid out as the football circuit's: your
    home goals, your away goals, real home goals, real away goals. 3 points for the exact score
    and nothing for anything else."""
    net = Net(16)
    my_home, my_away = bits(net, 0, 4), bits(net, 4, 4)
    real_home, real_away = bits(net, 8, 4), bits(net, 12, 4)

    exact = net.and_(net.same(my_home, real_home), net.same(my_away, real_away))

    net.set_outputs([exact, exact])
    return net


def basketball() -> Net:
    """Inputs (6): your winner (1 bit), your margin band (2 bits), real winner, real band."""
    net = Net(6)
    my_winner, my_band = net.inp(0), bits(net, 1, 2)
    real_winner, real_band = net.inp(3), bits(net, 4, 2)

    right_winner = net.same_bit(my_winner, real_winner)
    full = net.and_(right_winner, net.same(my_band, real_band))

    net.set_outputs([right_winner, full])
    return net


def tennis() -> Net:
    """Inputs (7): your winner (1 bit), your sets (2 bits), real winner, real sets, and one bit
    saying whether the match is best of 5.

    Sets are written as the number of sets minus 2, so 2 sets is 0 and 5 sets is 3.
    A number of sets that is impossible for the match type scores 0."""
    net = Net(7)
    my_winner, my_sets = net.inp(0), bits(net, 1, 2)
    real_winner, real_sets = net.inp(3), bits(net, 4, 2)
    best_of_5 = net.inp(6)

    def possible(sets: list[int]) -> int:
        low, high = sets
        in_best_of_3 = net.and_(net.not_(best_of_5), net.not_(high))      # 2 or 3 sets
        in_best_of_5 = net.and_(best_of_5, net.or_(low, high))            # 3, 4 or 5 sets
        return net.or_(in_best_of_3, in_best_of_5)

    allowed = net.and_(possible(my_sets), possible(real_sets))
    right_winner = net.and_(allowed, net.same_bit(my_winner, real_winner))
    full = net.and_(right_winner, net.same(my_sets, real_sets))

    net.set_outputs([right_winner, full])
    return net


CIRCUITS = {"football": football, "basketball": basketball, "tennis": tennis, "result": result, "goalgoal": goalgoal, "score": score}


def main() -> None:
    OUT.mkdir(exist_ok=True)
    manifest = {}
    for name, make in CIRCUITS.items():
        net = make()
        data, gates = net.netlist()
        (OUT / f"{name}.hex").write_text(data.hex() + "\n")
        manifest[name] = {
            "inputs": net.n_in,
            "outputs": 2,
            "gates": gates,
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        }
        print(f"{name:11} {net.n_in:2} inputs  2 outputs  {gates:3} gates  {len(data):4} bytes")
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
