"""Checks Kickoff's three scoring circuits against the written rules, on every possible case.

Run from the repository root:

    python3 circuits/check.py

For each circuit it does four things:

1. Confirms the saved circuit in circuits/out/ is exactly what build.py produces today.
2. Confirms it is a well-formed TapeOut circuit.
3. Feeds it every possible combination of inputs and compares the points with rules.py,
   the plain-code version of the rules. This is done twice, with two separate evaluators:
   Kickoff's own (tap02.py) and TapeOut's official reference evaluator (third_party/).
4. Damages the circuit on purpose, one gate at a time, and confirms the check notices.
   A check that cannot fail proves nothing.

It exits with an error if anything disagrees, and writes what it found to
circuits/out/check.json and docs/CHECK-RESULTS.md.
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "third_party"))

import build                       # noqa: E402
import rules                       # noqa: E402
import tap02                       # noqa: E402
import tap02_reference as official  # noqa: E402

OUT = HERE / "out"
RESULTS_PAGE = HERE.parent / "docs" / "CHECK-RESULTS.md"
BANDS = "ABCD"


# ---- what each circuit's input bits mean (the same layout circuits/README.md describes) ----

def number(bit_list: list[int]) -> int:
    """Lowest bit first."""
    return sum(bit << i for i, bit in enumerate(bit_list))


def football_expected(b: list[int]) -> int:
    return rules.football_points(number(b[0:4]), number(b[4:8]), number(b[8:12]), number(b[12:16]))


def basketball_expected(b: list[int]) -> int:
    side = ("home", "away")
    return rules.basketball_points(side[b[0]], BANDS[number(b[1:3])], side[b[3]], BANDS[number(b[4:6])])


def tennis_expected(b: list[int]) -> int:
    player = ("A", "B")
    return rules.tennis_points(
        player[b[0]], number(b[1:3]) + 2, player[b[3]], number(b[4:6]) + 2, 5 if b[6] else 3)


EXPECTED = {"football": football_expected, "basketball": basketball_expected, "tennis": tennis_expected}


# ---- the check itself ----

def points_from(outputs: list[int]) -> int:
    return outputs[0] + 2 * outputs[1]


def all_cases(n_in: int):
    for case in range(1 << n_in):
        yield [(case >> i) & 1 for i in range(n_in)]


def first_disagreement(gates, n_in: int, expected) -> list[int] | None:
    """Return the first input where the circuit and the rules disagree, or None if they never do."""
    for b in all_cases(n_in):
        outputs = tap02.unpack(tap02.evaluate(gates, n_in, 2, tap02.pack(b)), 2)
        if points_from(outputs) != expected(b):
            return b
    return None


def check(name: str) -> dict:
    manifest = json.loads((OUT / "manifest.json").read_text())[name]
    data = bytes.fromhex((OUT / f"{name}.hex").read_text().strip())
    n_in, expected = manifest["inputs"], EXPECTED[name]
    problems: list[str] = []

    # 1. The saved circuit is what the builder produces today.
    fresh, fresh_gates = build.CIRCUITS[name]().netlist()
    if fresh != data:
        problems.append("the saved circuit differs from what build.py produces")
    if hashlib.sha256(data).hexdigest() != manifest["sha256"]:
        problems.append("the saved circuit does not match its fingerprint in manifest.json")
    if (manifest["gates"], manifest["bytes"]) != (fresh_gates, len(data)):
        problems.append("the gate or byte count in manifest.json is wrong")

    # 2. It is a well-formed TapeOut circuit, by both readers.
    gates = tap02.read(data, n_in, 2)
    reference_circuit = official.load(data, n_in, 2)
    if reference_circuit.n_state != 0:
        problems.append("the circuit has memory, so eval() would refuse it")

    # 3. Every possible case, with both evaluators, against the plain-code rules.
    cases = wrong_own = wrong_official = 0
    totals = {0: 0, 1: 0, 3: 0}
    for b in all_cases(n_in):
        cases += 1
        want = expected(b)
        totals[want] += 1
        packed = tap02.pack(b)
        own = points_from(tap02.unpack(tap02.evaluate(gates, n_in, 2, packed), 2))
        _, outs = official.beat(reference_circuit, [], official.unpack(packed, n_in))
        wrong_own += own != want
        wrong_official += points_from(outs) != want
    if wrong_own:
        problems.append(f"Kickoff's evaluator disagrees with the rules on {wrong_own} cases")
    if wrong_official:
        problems.append(f"TapeOut's reference evaluator disagrees with the rules on {wrong_official} cases")

    # 4. Damage the circuit one gate at a time and make sure the check notices every time.
    #    Each gate in turn is forced to always answer 1.
    caught = 0
    for k in range(len(gates)):
        damaged = list(gates)
        damaged[k] = (0, 0)                                  # NAND(0, 0) is always 1
        caught += first_disagreement(damaged, n_in, expected) is not None
    if caught != len(gates):
        problems.append(f"only {caught} of {len(gates)} damaged copies were caught")

    return {
        "inputs": n_in,
        "gates": len(gates),
        "bytes": len(data),
        "sha256": manifest["sha256"],
        "cases_checked": cases,
        "cases_wrong_kickoff_evaluator": wrong_own,
        "cases_wrong_tapeout_reference_evaluator": wrong_official,
        "cases_scoring_0": totals[0],
        "cases_scoring_1": totals[1],
        "cases_scoring_3": totals[3],
        "damaged_copies_made": len(gates),
        "damaged_copies_caught": caught,
        "problems": problems,
    }


def results_page(results: dict) -> str:
    lines = [
        "# Check results for the scoring circuits",
        "",
        "This page is written by `python3 circuits/check.py`. Do not edit it by hand.",
        "",
        "Every possible combination of inputs was run through each circuit and compared with the",
        "plain-code rules in `circuits/rules.py`. Each case was evaluated twice: once with",
        "Kickoff's own evaluator and once with TapeOut's official reference evaluator for the",
        "circuit format (TAP-02). Then each circuit was damaged on purpose, one gate at a time,",
        "to confirm the check notices a wrong circuit.",
        "",
        "| Circuit | Inputs | Gates | Cases checked | Wrong (Kickoff evaluator) | Wrong (TapeOut reference) | Damaged copies caught |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for name, r in results.items():
        lines.append(
            f"| {name} | {r['inputs']} | {r['gates']} | {r['cases_checked']:,} | "
            f"{r['cases_wrong_kickoff_evaluator']} | {r['cases_wrong_tapeout_reference_evaluator']} | "
            f"{r['damaged_copies_caught']} of {r['damaged_copies_made']} |")
    lines += [
        "",
        "How the cases split by points:",
        "",
        "| Circuit | Score 0 | Score 1 | Score 3 |",
        "| --- | --- | --- | --- |",
    ]
    for name, r in results.items():
        lines.append(f"| {name} | {r['cases_scoring_0']:,} | {r['cases_scoring_1']:,} | {r['cases_scoring_3']:,} |")
    lines += ["", "Fingerprints (SHA-256) of the circuits that were checked:", ""]
    for name, r in results.items():
        lines.append(f"- {name}: `{r['sha256']}`")
    lines += [
        "",
        "What this does and does not show: the circuits give the same points as the written rules",
        "for every input they can receive. It was run off chain. It does not yet show that the",
        "circuits are published on X Layer or that a TapeOut processor returns the same answers.",
        "That is checked when they are published.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    results = {name: check(name) for name in build.CIRCUITS}
    (OUT / "check.json").write_text(json.dumps(results, indent=2) + "\n")
    RESULTS_PAGE.write_text(results_page(results))
    failed = False
    for name, r in results.items():
        state = "FAILED" if r["problems"] else "ok"
        print(f"{name:11} {r['cases_checked']:6,} cases  {r['gates']:3} gates  "
              f"damaged copies caught {r['damaged_copies_caught']}/{r['damaged_copies_made']}  {state}")
        for problem in r["problems"]:
            failed = True
            print(f"    - {problem}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
