# Rehearsal results

What happened when Kickoff's X Layer rehearsals were run. A rehearsal runs on a **private copy** of
X Layer mainnet with the real TapeOut contracts. Nothing is sent to the real network and nothing is
paid. What rehearsals 1 to 4 and the fees report do is explained in
[chain/README.md](../chain/README.md), and rehearsal 5 in [engine/README.md](../engine/README.md).

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

## Rehearsal 4: a whole season

| | |
| --- | --- |
| Date | 23 November 2026 |
| Run | <https://github.com/Mhiah/Kickoff/actions/runs/45224267112> |
| Commit | `f151257` |
| Result | **6 of 6 tests passed on the first run** (29 of 29 across every rehearsal in the same run) |

A league of three players played three matches, one in each sport. The picks were sealed and
bundled by the picks engine, and the chain did the rest with the real TapeOut contracts.

What was confirmed:

- **The engine and the chain agree.** Every fingerprint, every bundle root, every receipt and every
  value a league locks on chain, nine picks across three matches, was worked out again in Solidity
  and was exactly what the engine got.
- **The league locked each bundle through the real mailbox before kickoff**, writing to its own
  inbox, and the chain's time stamp on each lock was before that match's kickoff.
- **Every pick was opened, checked and scored on chain.** Each was checked against its fingerprint
  and its receipt, then scored by the sport's real circuit. Every score was the one the engine gave.
- **The totals are the engine's table:**

| Position | Player | Points, scored by the real circuits |
| --- | --- | --- |
| 1 | ada | 7 |
| 2 | bola | 4 |
| 3 | chidi | 1 |

- **Four ways of cheating were refused:** a bundle locked after kickoff is stamped late by the
  chain; a changed pick does not match what was sealed; another player's sealed pick cannot be
  opened under your own name; and a pick sealed for one match is not in another match's bundle.

What this rehearsal does not cover: reading a league's facts back from the chain to build the
table. Here the test knew where each lock was. Rehearsal 5 does that.

## Rehearsal 5: a season played on chain and read back

| | |
| --- | --- |
| Date | 23 November 2026 |
| Run | <https://github.com/Mhiah/Kickoff/actions/runs/45230433681> |
| Commit | `c52b822` |
| Result | **11 of 11 checks passed on the first run** |

This one is run by the picks engine itself, not by a Solidity test. GitHub starts a private copy of
X Layer (it was copied at block 76,686,687), and
[`engine/scripts/season-on-chain.js`](../engine/scripts/season-on-chain.js) plays a season on it
through the real TapeOut contracts. Then it keeps only the league's id, fetches the league back
from the node, and rebuilds the table.

What happened on the copy:

- A circuit was published on an existing TapeOut processor, paying in OKB only, and its account was
  opened. That account became the league.
- The league announced three matches, locked each bundle of sealed picks through the real mailbox
  10 minutes before kickoff, gave each result two hours after, and published each match's opened
  picks on its on-chain site through the real site store.
- One minute after the football kickoff, the host locked a changed bundle, with chidi's pick set to
  the real score.
- An outsider with their own TapeOut account wrote a 0-0 result to the league's inbox.
- A member disputed the football result.

What was confirmed when it was read back:

- **All 12 messages in the league's inbox were fetched**, each one checked against the fingerprint
  the mailbox stores for it.
- **The opened picks for all three matches were fetched from the league's site**, each file checked
  against the SHA-256 the site store keeps with it.
- **The table came out the same as in every other check:**

| Position | Player | Points |
| --- | --- | --- |
| 1 | ada | 7 |
| 2 | bola | 4 |
| 3 | chidi | 1 |

- **The changed bundle was refused.** The bundle locked before kickoff stayed in force. The changed
  one is on the record, marked as locked too late.
- **The outsider's result was ignored**, with the reason recorded: a result by someone other than
  the league.
- **The dispute is listed with its match**, from the member's account, inside the 24 hours.
- **The one-line command printed the same table** for the same league:
  `node engine/bin/table.js <league id>`.

What this rehearsal does not cover: a real league. The league here lived only on the copy and was
gone when the run ended. It also asks one node, the copy itself. Asking several independent nodes
and requiring them to agree is still to do.

## Rehearsal 6: the robot

| | |
| --- | --- |
| Date | 24 November 2026 |
| Run | <https://github.com/Mhiah/Kickoff/actions/runs/45378783993> |
| Commit | `e73380e` |
| Copy of X Layer at block | 76,748,495 |
| Result | **11 of 11 checks passed on the first run** |

The earlier rehearsals had a script play the league. This one has the real pieces do it: Kickoff's
server code, the robot's own rules and its own hands on X Layer, and phones that seal, enter and
open picks the way the website does. The robot signed every transaction with `cast` and a
throwaway key made for the run, which is how it will sign for real.

What happened:

- **The robot's wallet became a league** by publishing one small circuit on an existing TapeOut
  processor and opening its account. That cost 0.081967 OKB of test money.
- **Three matches went on Kickoff's list.** Three phones entered sealed picks for two of them.
- **While picks were open the robot wrote nothing.** Five seconds after picks closed for each of
  the two matches, it announced the match and locked its three sealed picks, 595 seconds before
  kickoff.
- **The match nobody picked was never written to X Layer.**
- **A changed bundle was locked with the league's own key two hours after kickoff**, with one
  player's pick swapped for the real score. That player then tried to open the swapped pick, and
  the server refused.
- **The robot recorded both results and published both files of opened picks.**
- **A second robot started with no memory and wrote nothing.** Seven messages were in the league's
  inbox before and after.
- **The table was rebuilt from the copy of X Layer alone** and came out as ada 6, bola 2, chidi 0.
  The lock in force for the football was the one made before kickoff, not the changed one. A
  reader found no message to disbelieve.

What it cost, on the copy: after the one fee for becoming a league, announcing and locking two
matches cost 0.000006 OKB, and recording two results and publishing two files cost 0.000008 OKB.
So the running cost of a match is a few millionths of an OKB. Nearly everything is the single fee
for opening the league's account.

What this rehearsal does not cover: the real network, a wallet holding real OKB, and time passing
at its real pace. On the copy the rehearsal sets the clock itself. The robot's timing is checked
separately, in its tests. It also covers three players. A match picked by more than 32 will not
fit in one file on the league's site yet.

## The fees report

| | |
| --- | --- |
| Date | 23 November 2026 |
| Run | <https://github.com/Mhiah/Kickoff/actions/runs/45219514524> |
| Commit | `85baf34` |
| Result | **2 of 2 passed on the first run** (23 of 23 across everything in the same run) |

What it found is written up in full in [FEES.md](FEES.md). In short:

- Creating Kickoff's own processor, publishing the three scoring circuits and a league circuit,
  opening the league's account and switching on its site's name costs **0.14 BEM and about 0.0853
  OKB**, in 16 transactions.
- Doing the same on an existing processor costs **about 0.0879 OKB and no BEM**. The probe published
  all four circuits there paying in OKB only.
- Either way, 0.08 OKB of it is the one fee for opening the league's account.
- BEM has 8 decimal places, which settles the amounts left in the token's smallest unit under
  rehearsal 1: the transistor fee is 0.01 BEM for each circuit, and creating a processor is 0.1 BEM.
