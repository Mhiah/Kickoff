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

| | |
| --- | --- |
| Date | 23 November 2026 |
| Run | <https://github.com/Mhiah/Kickoff/actions/runs/45216405278> |
| Commit | `7125a14` |
| Result | **5 of 5 tests passed** (and rehearsal 1 passed again in the same run, 11 of 11) |

What was confirmed, all with the real TapeOut contracts:

- **A league gets its own account.** Opening one worked, and TapeOut's opener and its mailbox agree
  on which account belongs to the circuit.
- **The account can hold prize money.** OKB sent to it by another wallet arrived and stayed there.
- **Only an opened account can send, but any account can receive.** The mailbox refused a message
  from a circuit whose account was not open, and accepted one addressed to a league whose account
  was still closed.
- **A message can be sent and read back.** The inbox recorded who sent it, the block and the time
  it arrived, and a fingerprint of it, and the text read back from the chain was the text sent.
- **One pick, start to finish.** Its fingerprint was sent before kickoff and stamped with a time
  before kickoff. A pick sent after kickoff was stamped late. The first pick was then opened and
  matched its fingerprint, a different score did not, the time on the original could not be
  changed, and the football circuit gave it 3 points.

Fee the rehearsal read from the chain:

| Fee | Amount | Paid in |
| --- | --- | --- |
| Opening a circuit's account | 0.08 OKB | OKB |

Sending a message has no fee of its own. It costs only the network's gas.

**The first run of this rehearsal failed, and why.** In
[the run before this one](https://github.com/Mhiah/Kickoff/actions/runs/45215959362), three of the
five tests failed with TapeOut's `NotHolder` error. The cause was a mistake in the test, not in
TapeOut or in Kickoff: the test looked up an address in between "act as the circuit's owner" and
the send, so the send went out from the wrong sender and the mailbox rightly refused it. The fix
was to do the lookup first. It is recorded here because it shows the mailbox really does check who
is sending.

What this rehearsal does not cover: encrypted messages. They are encrypted in the browser, so they
are tested with the picks engine.

## Rehearsal 3: the on-chain site

| | |
| --- | --- |
| Date | 23 November 2026 |
| Run | <https://github.com/Mhiah/Kickoff/actions/runs/45217742997> |
| Commit | `78628b7` |
| Result | **5 of 5 tests passed on the first run** (rehearsals 1 and 2 passed again in the same run, 21 of 21 in all) |

What was confirmed, with TapeOut's real site store:

- **A page can be uploaded and read back.** The bytes read from the chain were the bytes uploaded,
  the fingerprint stored on chain was the page's SHA-256, and the file was listed by name.
- **A bigger file goes up in pieces and reads back whole.** A 60,000-byte file was uploaded in
  three pieces. While only the first piece was there, the file did not match its fingerprint, so a
  half-uploaded file can be told apart from a finished one. Once complete it matched, and a read
  across the join between two pieces was seamless.
- **Only the owner can change the site.** A stranger's attempts to replace, add to and remove a
  page were all refused. The owner could do all three.
- **The site moves with the league.** After the circuit was handed to a new owner, the league's
  account was the same account and the page was unchanged, the old owner could no longer change
  it, and the new owner could.

What the probe found about a site's on-chain name:

| Question | Answer |
| --- | --- |
| What does the name cost? | Nothing at the moment. The monthly fee read from the chain was 0. |
| How must the name be written? | `<circuit id>.2.<processor number>.tape`. In the rehearsal that was `1.2.443.tape`: circuit 1, the 2 that stands for X Layer, processor 443. |
| What is the processor number? | The processor's place in the factory's list, counting from 0. |
| How long does one month buy? | 30 days. |

The number 443 belongs to the rehearsal. When Kickoff's processor is created on the real network
it gets whatever number is next at that moment.
