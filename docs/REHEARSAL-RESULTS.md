# Rehearsal results

What happened when Kickoff's X Layer rehearsals were run. A rehearsal runs on a **private copy** of
X Layer mainnet with the real TapeOut contracts. Nothing is sent to the real network and nothing is
paid. What each rehearsal does is explained in [chain/README.md](../chain/README.md).

Each entry links to the run on GitHub, where the full output can be read.

## Rehearsal 1: publishing the scoring circuits

| | |
| --- | --- |
| Date | 23 November 2026 |
| Run | <https://github.com/Mhiah/Kickoff/actions/runs/45214720749> |
| Commit | `f1ba4c8` |
| Result | **11 of 11 tests passed** |

What was confirmed:

- The real TapeOut factory created a Kickoff processor.
- The football (148 gates), basketball (20) and tennis (37) circuits were published as circuits 1,
  2 and 3, and the processor stored each one byte for byte.
- The real TapeOut evaluator gave the same points as the rules on every possible input:

| Circuit | Cases asked | Wrong |
| --- | --- | --- |
| Football | 65,536 | 0 |
| Basketball | 64 | 0 |
| Tennis | 128 | 0 |

- All thirteen worked examples from the rules page gave the right points.

Fees the rehearsal read from the chain:

| Fee | Amount | Paid in |
| --- | --- | --- |
| Publishing one circuit (tape-out) | 0.0013 OKB | OKB |
| Buying the transistors for one circuit | 1,000,000 of BEM's smallest unit, flat, whatever the circuit's size | BEM |

The BEM amount is given in the token's smallest unit because the rehearsal did not read how many
decimal places BEM has. The fees report will give it in whole BEM, along with the fee for creating
the processor.

## Rehearsal 2: a league's account and mailbox

Written, not yet recorded here. This section is filled in after its first run.
