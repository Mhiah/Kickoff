# What going live costs

Every figure on this page was read from X Layer or measured on a private copy of it by
`chain/test/Fees.t.sol`, on 23 November 2026
([the run](https://github.com/Mhiah/Kickoff/actions/runs/45219514524), commit `85baf34`). Nothing
was sent to the real network and nothing was paid.

Amounts are in OKB and BEM, the two tokens the fees are charged in. They are not given in dollars
or naira, because token prices move every day. Check the price in a wallet or on an exchange on the
day.

## The short version

| | Route A: Kickoff's own processor | Route B: an existing processor |
| --- | --- | --- |
| OKB needed | about 0.0853 | about 0.0879 |
| BEM needed | 0.14 | none |
| Transactions | 16 | 10 |
| The circuits are published under | Kickoff's own name | another project's processor |

Either way, almost all of the cost is one fee: **0.08 OKB to open the league's account.**

## What has to be paid for

Going live means doing these things once:

1. Have a processor to publish circuits from (create one, or use one that exists).
2. Publish the three scoring circuits: football, basketball and tennis.
3. Publish one more small circuit to be the first league.
4. Open that league's account, so it can hold a page, prize money and a mailbox.
5. Switch on the on-chain name for its site.

## Route A: Kickoff's own processor

TapeOut charges for creating a processor, and for buying transistors on a new one, in its **BEM**
token. Publishing a circuit and opening an account are charged in **OKB**.

| Step | TapeOut fee | Gas |
| --- | --- | --- |
| Allow the factory to take its BEM fee | none | 73,076 |
| Create the Kickoff processor | 0.1 BEM | 762,860 |
| Football circuit: allow the fee, buy 148 transistors, publish | 0.01 BEM + 0.0013 OKB | 979,204 |
| Basketball circuit: allow the fee, buy 20 transistors, publish | 0.01 BEM + 0.0013 OKB | 507,360 |
| Tennis circuit: allow the fee, buy 37 transistors, publish | 0.01 BEM + 0.0013 OKB | 556,540 |
| The league's own circuit: allow the fee, buy 1 transistor, publish | 0.01 BEM + 0.0013 OKB | 452,628 |
| Open the league's account | 0.08 OKB | 224,942 |
| Switch on the site's name for 12 months | 0 (free at the moment) | 212,862 |
| **Total** | **0.14 BEM + 0.0852 OKB** | **3,769,472** |

The gas price when this ran was 0.02 gwei, so all that gas came to about **0.000075 OKB**. The
network's extra charge for posting data to Ethereum was quoted as zero for every step.

**Route A in all: 0.14 BEM and about 0.0853 OKB.**

Two things worth knowing:

- **The transistor fee is flat.** It is 0.01 BEM for each purchase whatever the number of
  transistors, because Kickoff's processor sets its own transistor price to zero. The 148-gate
  football circuit costs the same to publish as the one-gate league circuit.
- **BEM has 8 decimal places.** Its address on X Layer, as given by the TapeOut factory itself, is
  `0x60e62Efa9405d6873C5deaBD4E6CC91c25363952`. Other tokens on X Layer have similar names. Only
  the one at this address is accepted.

## Route B: an existing processor

Anyone may publish a circuit on any processor. The probe tried it on processor 409
(`0x39E44DbA62811E87fDe122CA4d6c082568a384D0`), which another entry's public tests had found sells
transistors for nothing and charges in OKB.

| What the probe read from that processor | |
| --- | --- |
| Price of one transistor | 0 |
| Flat fee for each purchase | 0.00066 OKB |
| Fee to publish a circuit | 0.0013 OKB |
| Transistors it can ever sell | 100,000 |
| Transistors sold so far | 164 |

All four circuits were bought for and published there, paying in OKB only. They became circuits 5,
6, 7 and 8 of that processor. The TapeOut fees for all four came to **0.00784 OKB**.

Opening the league's account and switching on the name go through the same contracts as in Route A,
so they cost the same: 0.08 OKB and nothing. The probe did not repeat those two steps.

**Route B in all: about 0.0879 OKB, and no BEM.**

## Choosing between them

| | Route A | Route B |
| --- | --- | --- |
| What you must hold | OKB and BEM, both on X Layer | OKB on X Layer |
| Whose processor the circuits sit on | Kickoff's own, named Kickoff | Another project's |
| The address to give in the submission | Kickoff's processor | That project's processor |
| Depends on someone else | No | Yes: that processor keeps selling transistors only while its owner's supply lasts |
| Can it be changed later | Circuits are permanent. Moving means publishing them again on the other route, at the costs above. | Same |

Route A is the cleaner result and costs slightly less OKB, but it means getting a second token onto
X Layer. Route B is one token and fewer steps.

## Costs that repeat

These were measured once each and are not in the totals above.

| What | Gas | About, at 0.02 gwei |
| --- | --- | --- |
| Uploading one full piece of the site (24,000 bytes) | 5,924,259 | 0.000118 OKB |
| Sending one message through the mailbox | 213,010 | 0.0000043 OKB |

What that means in practice:

- **The site.** A site of 300,000 bytes is 13 pieces, about 0.0015 OKB. A site of a million bytes
  is 42 pieces, about 0.005 OKB.
- **A match.** A league sends about three messages for each match: one to lock everyone's picks,
  one to open them, one for the result. That is about 0.000013 OKB a match, so a 380-match football
  season costs a league about 0.005 OKB.

## What each extra league costs

A league that wants its own identity, meaning its own page, prize account and mailbox, needs its
own circuit and its own account:

| | Route A | Route B |
| --- | --- | --- |
| Publish the league's circuit | 0.01 BEM + 0.0013 OKB | 0.00196 OKB |
| Open its account | 0.08 OKB | 0.08 OKB |
| **For each league** | **0.01 BEM + 0.0813 OKB** | **0.082 OKB** |

That fee shapes the product. It is reasonable for a sponsored league, where a brand is already
paying to run a campaign. It is too much to ask of a group of friends. So free leagues are meant to
share Kickoff's own account, and a league gets its own identity when a sponsor pays for one.

## What running Kickoff costs, on the real network

Everything above was measured on a copy of the network before going live. This part is from
Kickoff's own transactions on X Layer on 25 November 2026, when the gas price was 0.02 gwei.
Anyone can look the transactions up.

**A match's messages.** The first two real matches cost six messages:

| Message | Gas | OKB | Transaction |
| --- | --- | --- | --- |
| Sabah FK v Barça is listed | 182,647 | 0.00000365 | `0xf3e5c74a0a7e01f4fdff0a0d12ab31c5dcb93ecacb63474b3adc974629856f35` |
| its predictions are locked | 150,667 | 0.00000301 | `0x1b45486d3b875d85f587f36cad9fca673f6b0e2cf89960484d4b05ce0544b45f` |
| Slavia Praha v Villarreal is listed | 148,543 | 0.00000297 | `0xa7c82ef3720d723dc7d387bad92cea9421f78f0bef17ce72d9af15c3ed0b6246` |
| its predictions are locked | 150,667 | 0.00000301 | `0xb0e79a1b4f20533aab39472c8fbb5ce7669804c4f77576d462e19b5d3ebd0d43` |
| the first result | 149,164 | 0.00000298 | `0x919aadc90c64a6af484ef56e73a23292cff29727ce4d437b1a8961e982291448` |
| the second result | 149,164 | 0.00000298 | `0x87ae17b6b884dc22527443b83da5c825f8397061066b71c527ce3c42898046a7` |

That is 0.0000186 OKB for two matches, so **about 0.0000093 OKB a match**. The robot's wallet held
0.034318 OKB before the first and 0.034300 OKB after the last. A football match is three
predictions, each locked and settled as its own match, so one with all three made costs about
0.000028 OKB. A match nobody predicted is never listed, and costs nothing.

**Publishing the opened predictions.** After a match, the opened predictions are written to
Kickoff's site on X Layer, so anyone can rebuild the leaderboard. Writing there costs by the byte.
One real piece of Kickoff's site, 14,500 bytes, cost 3,375,710 gas, which was 0.0000675 OKB: about
**0.0000047 OKB for every 1,000 bytes**.

How big the file is was measured by building it with the server's own code, not by sending it:

| Predictions on one match | Bytes for each | The whole file | OKB to publish it |
| --- | --- | --- | --- |
| 1 | 481 | 481 | 0.0000022 |
| 30 | 716 | 21,491 | 0.00010 |
| 100 | 848 | 84,837 | 0.00040 |
| 1,000 | 1,063 | 1,062,561 | 0.0049 |
| 5,000 | about 1,213 | about 6,065,000 | about 0.028 |

Each prediction in the file carries the proof that it was in the locked bundle, and that proof is
longer in a bigger crowd, which is why the bytes for each go up. The 5,000 row is worked out from
the pattern in the rows above it, not built. So a prediction costs between **0.0000033 and
0.0000057 OKB** to publish.

Two things to know:

- **No file of opened predictions has been published on the real network yet.** The cost by the
  byte is from the site's own files, which are written to the same place in the same way.
- **The file could be made much smaller.** The proof beside each prediction could be worked out by
  whoever reads the file, from the list itself, instead of being stored. That would cut most of
  the bytes. It is not built.

**A month of one sponsored group**, if every player makes 60 predictions:

| Players | Predictions | Bytes each | OKB |
| --- | --- | --- | --- |
| 100 | 6,000 | 848 | 0.024 |
| 1,000 | 60,000 | 1,063 | 0.30 |
| 5,000 | 300,000 | about 1,213 | 1.69 |

The messages for the matches themselves add less than 0.001 OKB a month to each row.

## How far to trust these numbers

- **The fees are TapeOut's and can change.** The name fee was zero when this ran. It may not stay
  zero.
- **Gas prices move.** The gas figures are fixed by what each step does, but what gas costs in OKB
  depends on the day.
- **These came from a copy of the network, not the network.** The copy used the real contracts and
  the real state, so the real thing should cost the same, give or take the gas price.
- **Keep a margin.** A wallet holding 0.1 OKB covers either route with room to spare, and 0.2 BEM
  covers Route A.
