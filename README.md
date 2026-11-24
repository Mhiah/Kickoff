# Kickoff

**A prediction game on real matches, where every pick is sealed before kickoff, scored by a rule nobody can change, and kept on a record nobody can edit.**

X Layer TapeOut Accelerate (OKX Build X Series). A new project, built during this event by Mhiah.

[![Circuit check](https://github.com/Mhiah/Kickoff/actions/workflows/check.yml/badge.svg)](https://github.com/Mhiah/Kickoff/actions/workflows/check.yml)
[![Engine tests](https://github.com/Mhiah/Kickoff/actions/workflows/engine.yml/badge.svg)](https://github.com/Mhiah/Kickoff/actions/workflows/engine.yml)
[![X Layer rehearsal](https://github.com/Mhiah/Kickoff/actions/workflows/rehearsal.yml/badge.svg)](https://github.com/Mhiah/Kickoff/actions/workflows/rehearsal.yml)
[![Season rehearsal](https://github.com/Mhiah/Kickoff/actions/workflows/season.yml/badge.svg)](https://github.com/Mhiah/Kickoff/actions/workflows/season.yml)
[![Website checks](https://github.com/Mhiah/Kickoff/actions/workflows/web.yml/badge.svg)](https://github.com/Mhiah/Kickoff/actions/workflows/web.yml)
[![Fixtures feed](https://github.com/Mhiah/Kickoff/actions/workflows/feed.yml/badge.svg)](https://github.com/Mhiah/Kickoff/actions/workflows/feed.yml)
[![Server tests](https://github.com/Mhiah/Kickoff/actions/workflows/server.yml/badge.svg)](https://github.com/Mhiah/Kickoff/actions/workflows/server.yml)
[![Robot](https://github.com/Mhiah/Kickoff/actions/workflows/robot.yml/badge.svg)](https://github.com/Mhiah/Kickoff/actions/workflows/robot.yml)

> [!NOTE]
> **Where this is today (23 November 2026).** The scoring rules, the picks engine, the website's
> screens and the fixtures feed are built and tested. The feed has been run against the real sports
> data and brought back this week's real matches. A pick can be sealed for real on a player's own
> device. Every TapeOut part Kickoff depends on has been rehearsed against the real contracts on a
> private copy of X Layer.
>
> **Not done yet:** nothing is live on X Layer itself, and the pieces are not joined up. The
> website still shows made-up matches, and a sealed pick is not sent anywhere. The section
> [Where the build is](#where-the-build-is) says exactly what exists.

## What Kickoff is

Kickoff is a prediction game for football and basketball fans. You and your friends predict the
results of real matches, such as Premier League games and NBA games, and a table shows who gets the
most right.

What makes it different from a spreadsheet or a group chat is that nobody can cheat. Your pick is
sealed before the match starts, so nobody can see it, copy it, or change it once the result is
known. The points are worked out by a published rule that nobody can alter. And the whole record is
kept on X Layer, where anyone can check it.

### The problem it solves

Every prediction league among friends or fans runs on trust. One person keeps the spreadsheet.
They can add a late pick, fix a score, or change the points rule halfway through the season, and
nobody could prove it. And after every match, everyone claims they predicted it, while the picks
they got wrong quietly disappear.

### How it works

1. **You start a group or join one with a code.** No wallet and no sign-up.
2. **Each week's real fixtures appear by themselves.** Nobody types them in.
3. **Before a match, you make your pick.** It is sealed on your own phone, so nobody can see it or
   copy it, not even Kickoff.
4. **Ten minutes before kickoff, picks close.** One fingerprint covering every sealed pick is
   written to X Layer, which stamps the time. A pick that turns up later does not count.
5. **After the match, the result comes in by itself** and every pick opens. Everyone is scored by
   the same fixed rule.
6. **Your group's table updates,** and every pick, right or wrong, stays on your record for good.

### The competitions and the points

| Sport | Competitions | What you predict | Points |
| --- | --- | --- | --- |
| Football | Premier League, Champions League | The exact score after 90 minutes | 3 for the exact score. 1 for the right winner, or for calling a draw, with the wrong score. 0 otherwise. |
| Basketball | NBA, WNBA | The winner and the winning margin, overtime included | 1 for the right winner, plus 2 more for the right margin: 1 to 5, 6 to 10, 11 to 15, or 16 or more. |

Every match gives at most 3 points. The extra 2 in basketball only count when the winner is right.
The full rules, with examples, are in [docs/RULES.md](docs/RULES.md).

**Tennis comes later.** Its scoring rule is built and checked like the other two, but no free feed
of tennis fixtures was found, so it is not offered yet.

### What makes it different

- **No trusted organiser.** Nobody, including the person who started the group and Kickoff itself,
  can change a pick, a score or the table after kickoff.
- **The rules are fixed in public.** Each sport's scoring rule is a published circuit that can
  never be changed.
- **Nobody enters the matches or the results.** They come from live sports data, so nobody in a
  group can get one wrong on purpose.
- **Anyone can check the table.** It is not kept in a private database. Anyone can read the record
  on X Layer and rebuild the same table with one command.
- **Your record is yours.** It shows hits and misses and cannot be edited.

## Who it is for

- **Friend groups** who already run a predictor league on a spreadsheet or a group chat.
- **Fan communities** that want a table nobody argues about.
- **Brands** that want to run a prediction campaign for their audience.

## How it earns

Brands pay to run sponsored groups with prizes, and private groups pay for extras.

Kickoff is a prediction game and it is free to play. Players predict, and play for the table.

## How it runs, piece by piece

This is what happens behind the screens, and how far each piece has got.

### 1. Real fixtures arrive from two feeds

A small program in [`feed/`](feed/) asks two sports-data services for the week's matches:

| Feed | Competitions |
| --- | --- |
| [football-data.org](https://www.football-data.org) | Premier League, Champions League |
| [balldontlie](https://www.balldontlie.io) | NBA, WNBA |

It puts every match into one shape, whichever feed it came from, and turns each finished match
into a result the scoring rules can take:

- **Football:** the score after 90 minutes. A match that ended 3 – 2 after extra time counts as the
  2 – 2 it was at 90 minutes.
- **Basketball:** the winner and the winning margin from the final score, overtime included.
- **Postponed, called off, abandoned or awarded by a committee:** void, so nobody scores.
- **Anything the feed cannot be sure of** (a finished match with no score, say) is marked "not
  sure" with the reason and gets no result until a person has looked. Nothing is guessed.

**The two keys.** Each feed needs a key, which is free with an account on its site. A key is a
password for a program: it tells the feed who is asking.

- Kickoff's two keys are kept in this repository's **GitHub secrets**, under the names
  `FOOTBALL_DATA_KEY` and `BALLDONTLIE_KEY`. A secret can be used by GitHub when it runs the
  program, but nobody can read it, including people with access to the repository.
- The keys are not in the code and not in this repository's history.
- When the program runs, each key is sent only to the feed it belongs to. It is never printed,
  saved, or put in a web address.
- Anyone who wants to run the feed from their own copy needs their own two keys. Both are free:
  one from football-data.org's sign-up page, one from balldontlie's.

**It has run live.** On 23 November 2026 the feed was run on GitHub with the real keys
([the run](https://github.com/Mhiah/Kickoff/actions/runs/45249885790)). For 23 to 30 November it
brought back:

| Competition | Matches |
| --- | --- |
| Premier League | 11 |
| Champions League | 18 |
| NBA | 53 |
| WNBA | 0 (out of season) |

Five NBA games had already finished, and each came back with its result worked out. Warriors 88,
Celtics 87, for example, came back as "the home side by 1 to 5". Nothing was reported as left out
or uncertain.

To run it again: open the repository's **Actions** tab, choose **Fixtures feed**, and press **Run
workflow**. The fixtures appear on the run's summary page. More in [feed/README.md](feed/README.md).

**State: built, tested and run live.** The matches are not yet shown on the website or written to
X Layer.

### 2. A pick is sealed on the player's own device

The first time someone picks, their device makes its own player id. Pressing "Seal my pick" works
out the pick's **fingerprint**: a short code made from the pick and a secret random number that
never leaves the device. Nobody can work the pick out from the fingerprint.

The pick and its secret stay in that browser. Only the fingerprint is ever meant to leave it
before kickoff.

**State: built and working on the website.** For a real match the phone then sends the fingerprint
to Kickoff's server, fetches and checks its receipt once picks are locked, and opens the pick after
kickoff, all by itself. That is built and checked against the server's own code. **It is live:**
the robot (see [robot/README.md](robot/README.md)) put 74 real matches on the server's list on
24 November 2026 and keeps them up to date every half hour, so the site now shows real Premier
League, Champions League and NBA matches to pick.

### 3. Picks are locked on X Layer before kickoff

Ten minutes before a match starts, every sealed pick for it is gathered into a **bundle**, and one
fingerprint covering the whole bundle is written to Kickoff's mailbox on X Layer. X Layer stamps
the time. Each player gets a **receipt** proving their sealed pick is in the bundle.

From then on nothing can be changed: a different pick would not match its fingerprint, and a
bundle written after kickoff is stamped late and never counts.

Gathering the sealed picks is the job of **Kickoff's server**. A player has no wallet, so each
device makes its own key and signs everything it sends, and the server refuses anything not signed
by the right key. The server is only ever sent fingerprints before kickoff, never picks. More in
[server/README.md](server/README.md).

**State: the engine does all of this, and it has been rehearsed against the real TapeOut contracts
on a private copy of X Layer.** It is not running on X Layer itself. **The server's rules are built
and tested,** including a test that goes from three phones, through the server, to the final table.
**It is online** at <https://kickoff-two-xi.vercel.app>, with a real database. The website uses it
for groups: start one, share the code, and friends join from their own phones.

### 4. Results come in and picks are scored by a fixed rule

After the match, the result from the feed is written to the same mailbox. Players' devices give
out each pick and its secret, and anyone can check each one against its fingerprint, its receipt
and the lock on X Layer.

Each pick is then scored by its sport's **scoring circuit**: a small published rule that takes a
pick and a result and gives 0, 1 or 3 points. Once published it cannot be changed, and anyone can
run it for free.

**State: the circuits are built and checked on every possible case. Scoring with the real TapeOut
contracts has been rehearsed.** The circuits are not published on X Layer itself yet.

### 5. The table is rebuilt from the record, never stored

Nothing keeps a table. Anyone can read Kickoff's mailbox on X Layer, apply the rules written in
[docs/PROTOCOL.md](docs/PROTOCOL.md), and work the table out:

```
node engine/bin/table.js <Kickoff's id on X Layer>
```

Everyone who does this gets the same table. A message from anyone but Kickoff's own account is
ignored, and a player's dispute of a result can never be hidden.

**State: built, and rehearsed end to end on a private copy of X Layer,** including a host cheating
with a late bundle and an outsider writing a false result. Both were refused.

### 6. The website

Seven screens, in light and dark, for a phone and a computer: home, the group's league, making a
pick, a match, a player's record, a proof screen called "Check it yourself", and the group. More in
[web/README.md](web/README.md).

**State: built. Making a pick is real. The matches, table and results shown are made up,** and each
screen says so at its foot.

## TapeOut, plainly

Kickoff is built on TapeOut, the protocol this hackathon is about. Think of TapeOut as a toolbox.
These are the tools, what each one is in plain words, and the job it does in Kickoff.

| Tool | What it is in plain words | Its job in Kickoff |
| --- | --- | --- |
| **Circuit** | A tiny rule machine. You give it facts, it gives an answer, and once it is published nobody can change it. | The scoring rules, one per sport. Free for anyone to check. |
| **Processor** | The workshop a circuit is published from. | Where Kickoff's scoring rules are published. |
| **Container** | An account that belongs to a circuit, so it can hold money and own a page. | Kickoff's own account on X Layer. Everything Kickoff says is said from it, and nothing said by any other account counts. |
| **TapeSend** | A mailbox for those accounts, where every message is stamped with who sent it and when. | The public record: each match announced, each bundle of sealed picks locked before kickoff, each result, and each dispute. |
| **DeWEB** | A website stored on the blockchain, so it cannot be secretly changed. | The verified copy of the Kickoff site, and where the opened picks are published after each match. |
| **TapeKit** | The checker that opens a DeWEB site and confirms it is genuine. | Comes with DeWEB. It is how a visitor knows the site is the real one. |
| **TapeCode** | The tool for uploading to all of the above. | Uploading the site and attaching a normal web address. |

Not used: FabX (mining). It has no role in this product.

TapeOut already has a published draft standard for sealed forecasts, TAP-12: a claim is sealed on
chain, opened at a set time, then judged in public, so anyone can rebuild the same track record.
That document leaves scoring and leaderboards for others to build. Kickoff is that layer.

Not every part of Kickoff runs inside a circuit, and it does not need to. TapeOut is used where it
gives the guarantee: sealed picks, a fixed scoring rule and a permanent record. The pages you click
through are an ordinary website, and the fixtures come from ordinary sports data.

## What has been checked so far

| What | How it was checked | Result |
| --- | --- | --- |
| The three scoring circuits | Every possible case, four separate ways: Kickoff's own evaluator, TapeOut's official reference evaluator, the real TapeOut contracts, and the JavaScript reader the website uses | 65,728 cases, 0 wrong ([details](docs/CHECK-RESULTS.md)) |
| The TapeOut parts | Five rehearsals and a fees report on a private copy of X Layer, against the real contracts: publishing circuits, an account and its mailbox, the on-chain site, and two whole seasons | All passed ([details](docs/REHEARSAL-RESULTS.md)) |
| The picks engine | 127 tests. Twenty-three try to cheat, and five have the X Layer node lie about what is on chain | All pass; every cheat and every lie is refused ([details](engine/README.md)) |
| The website | 59 checks, many of them run against the real server's code, and clicked through in a browser in both light and dark | All pass ([details](web/README.md)) |
| The fixtures feed | 22 tests against saved examples, and one live run against the real feeds | All pass; the live run fetched 82 real matches ([details](feed/README.md)) |
| The server | 63 tests. They link a wallet that did not sign, send picks in someone else's name, play old requests back, open a different pick from the one sealed, and use the robot's addresses without its key | All pass; every one is refused ([details](server/README.md)) |
| The robot | 42 tests, run against the server's own code: new matches, results, postponements, moved matches, a failing feed, where each key is sent, being on time for every lock, never writing twice, refusing a bundle that does not add up, and going live without paying for anything twice | All pass ([details](robot/README.md)) |
| The robot on a copy of X Layer | The robot's own code announcing, locking, recording results and publishing opened picks through TapeOut's real contracts, signing with `cast`, then the table rebuilt from the chain alone | 11 of 11 checks passed on the first run ([rehearsal 6](docs/REHEARSAL-RESULTS.md)) |
| What going live costs | Read from X Layer and measured on the private copy | About 0.09 OKB by the route that needs only one token ([details](docs/FEES.md)) |

GitHub repeats the tests on every change, and the badges at the top of this page show the latest
results.

## Honest limits

- **Nothing is live on X Layer yet.** Everything on chain so far happened on a private copy.
- **The pieces are only partly joined up.** Groups on the website are real. The matches, table and
  results are still made up, so no sealed pick has been sent on the live site yet.
- **A player is one phone and browser.** The key that makes someone a player is kept in the
  browser. If its saved data is cleared, that player is gone. A backup is still to do.
- **A result is the feed's word.** Kickoff checks that it is a result that can happen, not that it
  is true. That is why any player can dispute a result, and why a dispute can never be hidden.
- **More than 32 players on one match will not fit on chain yet.** The opened picks for a match
  are published as one file on the league's on-chain site, which takes 24,000 bytes: 32 players.
  Splitting the file is still to do.
- **Picks are locked on Kickoff's server, not yet on X Layer.** Once picks close the server
  bundles them and nothing can be added. But until the robot writes each bundle's fingerprint to
  X Layer, that lock is Kickoff's word and not something anyone can check on chain.
- **Sealed picks will pass through Kickoff's server.** A player needs no wallet, so the server
  gathers the fingerprints and Kickoff locks them. The server never sees a pick before kickoff and
  cannot change one or add one afterwards, but it could leave one out. Each player's receipt is the
  proof their pick was included. The receipt is not signed yet, so Kickoff could deny having issued
  it. Signing receipts is still to do.
- **A pick lives in the browser's storage.** If that is cleared, the secret is gone and the pick
  can never be opened. A way to back it up is still to do.
- **The table reader asks one X Layer node.** It checks every message against the mailbox's own
  fingerprint, but it believes that node about what the mailbox holds. TapeOut's own rule is to
  ask several nodes and require them to agree. That is still to do.
- **The free feeds have edges.** The football plan gives scores after a delay, which is fine for
  final results. It does not cover the Europa League. The WNBA is out of season, so it shows no games until its next season starts.
- **The feed's saved test examples are built from the feeds' documentation,** not captured from
  them. The live run saved the real answers, and adding those to the tests is still to do.
- **The live run had no finished football match in it,** because the week's football had not been
  played yet. The 90-minute rule has been checked against the feed's documented examples, not yet
  against a real finished match.
- **Parts of [docs/RULES.md](docs/RULES.md) and [docs/PROTOCOL.md](docs/PROTOCOL.md) still describe
  a league run by a host** who adds matches and enters results. The rules for points and for what
  counts on chain are unchanged, but the wording will be brought up to date with the server and
  the robot.
- **TAP-12 is still a draft.** The standard Kickoff builds on may change.
- **Nothing here is audited.**

## Where the build is

| Stage | What it is | State |
| --- | --- | --- |
| 1 | Project setup: this README, the folders, the licence | Done |
| 2 | The scoring circuits, and the checker that tests every possible case | Done. Not published on X Layer yet. |
| 3 | Proving the TapeOut parts on a private copy of X Layer | Done. Rehearsals 1 to 4 and the fees report, 29 tests against the real contracts. |
| 4 | The picks engine and the table builder | Done, 127 tests, with a fifth rehearsal that plays a season on chain and reads it back. Still to do: asking several nodes instead of one. |
| 5 | The website's screens | Done, with made-up data. |
| 6 | Sealing a pick for real, on the player's own device | Done. |
| 7 | The fixtures feed | Done, and run live against the real feeds. |
| 8 | Kickoff's server: groups, names, and sealed picks until they are locked | Partly done. The rules, signed requests, addresses and database connection are built, with 63 tests, and it is online with a real database. The website uses it for groups, and is ready to send sealed picks, check receipts and open picks once real matches are on the list. |
| 9 | The robot: announces fixtures, locks picks before kickoff and posts results on X Layer | Partly done. It keeps Kickoff's list of matches in step with the feeds every half hour, with 14 tests, and is running live. Its work on X Layer (locking each match's picks before kickoff, recording results, publishing opened picks) is built and rehearsed on a private copy of X Layer, and gets switched on when Kickoff goes live. 32 tests. |
| 10 | Joining it up: real fixtures and real tables on the website | Not started |
| 11 | Going live on X Layer: the circuits and Kickoff's account | Partly done. The switch is built, with 10 tests, and rehearsed on a private copy of X Layer: a look that says the cost and sends nothing, and a go that needs the words GO LIVE. Nothing is on the real X Layer yet, because the robot has no wallet. |
| 12 | Publishing the site, with the verified copy on DeWEB | Not started |
| 13 | A real test group with real people and real matches | Not started |
| 14 | Players with their own TapeOut identity, and sponsor prizes | Partly done. A player who has a wallet can link it, which costs nothing and is never required: on a new phone, linking the same wallet brings their groups back. Other players are told only that a wallet is linked, never which one. Prizes are not started. |
| 15 | Demo video and submission | Not started |

**The scoring circuits**

| Circuit | Gates | Cases checked | Cases wrong |
| --- | --- | --- | --- |
| Football | 148 | 65,536 (every possible case) | 0 |
| Basketball | 20 | 64 (every possible case) | 0 |
| Tennis | 37 | 128 (every possible case) | 0 |

Nothing is deployed, so there are no contract addresses, no circuit IDs and no live link yet. They
will be listed here as soon as they exist.

## Try it yourself

You need Node 22 or newer. The circuit check also needs Python 3. Nothing has to be installed.

| To do this | Run this |
| --- | --- |
| Check the scoring circuits on every possible case | `python3 circuits/check.py` |
| Run the picks engine's tests | `cd engine && npm test` |
| Run the website's checks | `node --test "web/test/*.test.js"` |
| See the website on your own computer, with groups working | `node server/bin/dev.js`, then open `http://localhost:8787` |
| Run the feed's tests (no key needed) | `cd feed && npm test` |
| Run the server's tests | `cd server && npm test` |
| Run the robot's tests | `cd robot && npm test` |
| Fetch this week's real fixtures (needs your own two keys) | `FOOTBALL_DATA_KEY=... BALLDONTLIE_KEY=... node feed/bin/fixtures.js` |

The rehearsals on a private copy of X Layer need [Foundry](https://getfoundry.sh), and are
explained in [chain/README.md](chain/README.md) and [engine/README.md](engine/README.md).

## What is in this repository

| Folder | What goes in it |
| --- | --- |
| `circuits/` | The three scoring circuits in TapeOut's format, and the checker. Start with [circuits/README.md](circuits/README.md) |
| `chain/` | Rehearsals of the parts that touch X Layer, run on a private copy of it. Start with [chain/README.md](chain/README.md) |
| `engine/` | The picks engine: sealing, bundling, opening, scoring with the circuits, the table, and reading it all back from X Layer. Start with [engine/README.md](engine/README.md) |
| `feed/` | The fixtures feed: real matches and results from live sports data. Start with [feed/README.md](feed/README.md) |
| `robot/` | Kickoff's robot: keeps the list of matches in step with the feeds. Start with [robot/README.md](robot/README.md) |
| `server/` | Kickoff's server: groups, and sealed picks until they are locked. Start with [server/README.md](server/README.md) |
| `api/`, `vercel.json` | What the web host needs: where the server starts, and where the website's files are |
| `web/` | The website. Start with [web/README.md](web/README.md) |
| `docs/` | The rules in plain words, what goes on chain, test results, rehearsal results and fees. Start with [docs/README.md](docs/README.md) |

## License

MIT
