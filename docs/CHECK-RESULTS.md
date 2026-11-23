# Check results for the scoring circuits

This page is written by `python3 circuits/check.py`. Do not edit it by hand.

Every possible combination of inputs was run through each circuit and compared with the
plain-code rules in `circuits/rules.py`. Each case was evaluated twice: once with
Kickoff's own evaluator and once with TapeOut's official reference evaluator for the
circuit format (TAP-02). Then each circuit was damaged on purpose, one gate at a time,
to confirm the check notices a wrong circuit.

| Circuit | Inputs | Gates | Cases checked | Wrong (Kickoff evaluator) | Wrong (TapeOut reference) | Damaged copies caught |
| --- | --- | --- | --- | --- | --- | --- |
| football | 16 | 148 | 65,536 | 0 | 0 | 148 of 148 |
| basketball | 6 | 20 | 64 | 0 | 0 | 20 of 20 |
| tennis | 7 | 37 | 128 | 0 | 0 | 37 of 37 |

How the cases split by points:

| Circuit | Score 0 | Score 1 | Score 3 |
| --- | --- | --- | --- |
| football | 36,480 | 28,800 | 256 |
| basketball | 32 | 24 | 8 |
| tennis | 102 | 16 | 10 |

Fingerprints (SHA-256) of the circuits that were checked:

- football: `7a663a0ed0040e6ce9952091fb796458f21dcb5e80ac4c8369ef2f147cb9e87b`
- basketball: `1c94a4cc1a6428c9e4ad27055fc3421245d74cadd625fb327a7628d6d4d1f480`
- tennis: `28d758b254c1193a1d80d7f4695545a20563bb86d6258379de6dc8fa077c11be`

What this does and does not show: the circuits give the same points as the written rules
for every input they can receive. It was run off chain. It does not yet show that the
circuits are published on X Layer or that a TapeOut processor returns the same answers.
That is checked when they are published.
