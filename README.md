# Kickoff

**A prediction game on real matches, where every prediction is sealed before kickoff, scored by a rule nobody can change, and kept on a record nobody can edit.**

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
> **Where this is today (25 November 2026).** Kickoff is live. The website shows real Premier
> League, Champions League and NBA matches. Friends play in groups, with no wallet and no sign-up.
> Kickoff's robot locks every match's sealed predictions on X Layer, through TapeOut, before kickoff, and
> anyone can check the record from their own browser.
>
> **Still to come:** the copy of the website on X Layer itself (built and tested, not published
> yet), prizes for groups run by brands, and a test with a real group of friends. The section
> [Where the build is](#where-the-build-is) says exactly what exists.

## Live on X Layer

| | |
| --- | --- |
| Play it | <https://kickoff-two-xi.vercel.app> |
| Chain | X Layer mainnet (chain 196) |
| TapeOut processor | `0x39e44dba62811e87fde122ca4d6c082568a384d0`, processor number 409. It is a shared processor that anyone may publish on. Kickoff did not need one of its own. |
| Circuit IDs on it | **5** is the league itself. **6** is the football scoring rule, **7** basketball, **8** tennis. |
| The league's account (its TapeOut container) | `0x24ad6fe8a46a34fa9b0610959beaba8a2c6b6982` |
| Kickoff's id in TapeOut's mailbox | `0x0000000000000000000000c424ad6fe8a46a34fa9b0610959beaba8a2c6b6982` |
| The robot's wallet, which holds circuit 5 | `0x37ffd5b3e27dd5ce04945559def00b66d5841fc1` |
| TapeOut contracts Kickoff writes to | The mailbox (TapeSend) `0xe61a9c7213a6aa616c246a2b569e555b417b25ee` and the site store (DeWEB) `0xd6efb7adcc9c83dc4924ad56f6a8e4e969b9adb6` |
| Live since | 24 November 2026. Going live cost 0.087878 OKB. |

**TapeOut features used:** circuits (the scoring rules), a circuit's container (the league's
account), TapeSend (the record of every lock and result) and DeWEB (the opened predictions, and the copy
of the website). [TapeOut, plainly](#tapeout-plainly) says what each one does here.

### Check it yourself

Nothing below needs a wallet, an account or Kickoff's permission.

1. **In a browser.** Open the site and go to the **Check** tab. Your own browser asks an X Layer
   node for the league's record and works the points out again with the published scoring rules.
   It shows when each of your predictions was locked, your group's points from X Layer beside Kickoff's
   own, and whether the order is the same.
2. **With one command.** This rebuilds the whole leaderboard from X Layer and nothing else:

   ```
   node engine/bin/table.js 0x0000000000000000000000c424ad6fe8a46a34fa9b0610959beaba8a2c6b6982
   ```

   It only reads. `node engine/bin/table.js --circuit 0x39e44dba62811e87fde122ca4d6c082568a384d0 5`
   does the same starting from the processor and the circuit ID.
3. **The scoring rules.** Circuits 6, 7 and 8 on the processor are the files in
   [`circuits/out/`](circuits/out/). `python3 circuits/check.py` runs each one on every possible
   prediction and result.

## What Kickoff is

Kickoff is a prediction game for football and basketball fans. You and your friends predict the
results of real matches, such as Premier League games and NBA games, and a leaderboard shows who gets the
most right.

What makes it different from a spreadsheet or a group chat is that nobody can cheat. Your prediction is
sealed before the match starts, so nobody can see it, copy it, or change it once the result is
known. The points are worked out by a published rule that nobody can alter. And the whole record is
kept on X Layer, where anyone can check it.

### The problem it solves

Every prediction league among friends or fans runs on trust. One person keeps the spreadsheet.
They can add a late prediction, fix a score, or change the points rule halfway through the season, and
nobody could prove it. And after every match, everyone claims they predicted it, while the predictions
they got wrong quietly disappear.

### How it works

1. **You start a group or join one with a code.** No wallet and no sign-up. A group holds up to 30
   friends. A group run by a brand holds up to 5,000.
2. **Each week's real fixtures appear by themselves.** Nobody types them in.
3. **Before a match, you make your prediction.** It is sealed on your own phone, so nobody can see it or
   copy it, not even Kickoff.
4. **Ten minutes before kickoff, predictions close.** One fingerprint covering every sealed prediction is
   written to X Layer, which stamps the time. A prediction only counts if it was locked there before
   kickoff.
5. **After the match, the result comes in by itself** and every prediction opens. Everyone is scored by
   the same fixed rule.
6. **The leaderboards update:** one for your group and one for everyone who plays. Every prediction,
   right or wrong, stays on your record for good.

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
  can change a prediction, a score or the leaderboard after kickoff.
- **The rules are fixed in public.** Each sport's scoring rule is a published circuit that can
  never be changed.
- **Nobody enters the matches or the results.** They come from live sports data, so nobody in a
  group can get one wrong on purpose.
- **Anyone can check the leaderboard.** It is not kept in a private database. Anyone can read the record
  on X Layer and rebuild the same leaderboard with one command.
- **Your record is yours.** It shows hits and misses and cannot be edited.

## Who it is for

- **Friend groups** who already run a predictor league on a spreadsheet or a group chat.
- **Fan communities** that want a leaderboard nobody argues about.
- **Brands** that want to run a prediction campaign for their audience.

**People who have never used crypto can play.** There is nothing to install, no wallet and no
sign-up: open the link, type a name, prediction. **People who have a wallet can link it,** which costs
nothing, is never required, and brings their groups back on a new phone.

## How it reaches them

- **Every group brings its own players.** A group is started in a few seconds and shared as a
  code, in the group chat the friends already have.
- **A brand brings its audience.** A group run by a brand is one code the brand posts to its
  followers. It holds up to 5,000 players, shows who runs it and what the prize is, and has its own
  leaderboard.

## Why people come back

- There are new real matches every week, in four competitions.
- The leaderboard moves after every match, and nobody shares a place.
- Your record keeps every prediction, the hits and the misses, so calling a result means something.

## How it earns

Brands pay to run sponsored groups with prizes, and private groups pay for extras.

Kickoff is a prediction game and it is free to play. Players predict, and play for the
leaderboard. Nobody puts money on a match.

**Built:** groups run by brands. Kickoff starts one for a brand, with the brand's name and a line
about the prize. **Not built yet:** paying a prize out, and any way for a brand or a group to pay
Kickoff. Today everything is free.

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

**State: built, tested and running live.** Kickoff's robot runs it every half hour, and the matches
it brings back are the ones on the website.

### 2. A prediction is sealed on the player's own device

The first time someone predictions, their device makes its own player id. Pressing "Seal my prediction" works
out the prediction's **fingerprint**: a short code made from the prediction and a secret random number that
never leaves the device. Nobody can work the prediction out from the fingerprint.

The prediction and its secret stay in that browser. Only the fingerprint is ever meant to leave it
before kickoff.

**State: built and working on the website.** For a real match the phone then sends the fingerprint
to Kickoff's server, fetches and checks its receipt once predictions are locked, and opens the prediction after
kickoff, all by itself. That is built and checked against the server's own code. **It is live:**
the robot (see [robot/README.md](robot/README.md)) put 74 real matches on the server's list on
24 November 2026 and keeps them up to date every half hour, so the site now shows real Premier
League, Champions League and NBA matches to predict.

### 3. Predictions are locked on X Layer before kickoff

Ten minutes before a match starts, every sealed prediction for it is gathered into a **bundle**, and one
fingerprint covering the whole bundle is written to Kickoff's mailbox on X Layer. X Layer stamps
the time. Each player gets a **receipt** proving their sealed prediction is in the bundle.

From then on nothing can be changed: a different prediction would not match its fingerprint, and a
bundle written after kickoff is stamped late and never counts.

Gathering the sealed predictions is the job of **Kickoff's server**. A player has no wallet, so each
device makes its own key and signs everything it sends, and the server refuses anything not signed
by the right key. The server is only ever sent fingerprints before kickoff, never predictions. More in
[server/README.md](server/README.md).

**A prediction only counts if it was locked on X Layer before kickoff.** The robot tells Kickoff's server
how each lock went, and the server gives points only for matches it has been told were locked. If a
match's predictions are ever not locked in time, nobody scores for that match, the website says "Not
locked in time" beside each prediction, and it is not counted as a prediction anyone got wrong. So Kickoff's own
leaderboards never show points that X Layer cannot back up.

**State: live on X Layer since 24 November 2026.** Kickoff's robot locks each match's sealed predictions a
few seconds after predictions close, ten minutes before kickoff. Any number of players can predict the same
match. The server is online at <https://kickoff-two-xi.vercel.app>, with a real database.

### 4. Results come in and predictions are scored by a fixed rule

After the match, the result from the feed is written to the same mailbox. Players' devices give
out each prediction and its secret, and anyone can check each one against its fingerprint, its receipt
and the lock on X Layer.

Each prediction is then scored by its sport's **scoring circuit**: a small published rule that takes a
prediction and a result and gives 0, 1 or 3 points. Once published it cannot be changed, and anyone can
run it for free.

The opened predictions for a match are published as one file on the league's own on-chain site, in as
many pieces as the file needs. Nothing about a prediction in that file is taken on trust: every opened
prediction has to prove itself against the lock that was written before kickoff.

**State: live.** The three circuits are published on X Layer as circuits 6, 7 and 8, and were
checked on every possible case before that. The robot writes each result and publishes the opened
predictions. Kickoff's server scores with the same three circuits, and a test fails if its copy ever
differs from the published files.

### 5. The leaderboard is rebuilt from the record, never stored

Nothing keeps a leaderboard. Anyone can read Kickoff's mailbox on X Layer, apply the rules written in
[docs/PROTOCOL.md](docs/PROTOCOL.md), and work the leaderboard out:

```
node engine/bin/table.js <Kickoff's id on X Layer>
```

Everyone who does this gets the same leaderboard. A message from anyone but Kickoff's own account is
ignored, and a player's dispute of a result can never be hidden.

**The order.** Most points first. Between players level on points, whoever joined Kickoff first is
ahead, so nobody shares a place. Joining happens on Kickoff, not on X Layer, so each player's
joining time is published with the opened predictions. That lets anyone put the leaderboard in the same
order Kickoff does.

**State: live.** The command above works on the real X Layer today, and the website's Check tab does
the same reading in the player's own browser. It was also rehearsed end to end on a private copy of
X Layer, including a host cheating with a late bundle and an outsider writing a false result. Both
were refused.

### 6. The website

Seven screens, in light and dark, for a phone and a computer: home, the league, making a prediction, a
match, a player's record, a proof screen called "Check it yourself", and the group. More in
[web/README.md](web/README.md).

- **League:** this week's real matches, and two leaderboards: everyone who plays, and your group.
- **My record:** your points, how many predictions you have made and won, and every prediction with its stage.
- **Check:** read from X Layer by your own browser, not from Kickoff.
- **Group:** the invite code, who is in, the next match to predict, and an optional wallet link. A
  group run by a brand says who runs it and what the prize is, and is too big to list by name.

**State: live, with real matches and real numbers.** Until a real match is on the list, the screens
show made-up matches and say so at their foot.

### 7. The robot keeps it moving

Nobody runs Kickoff by hand. A robot, in [`robot/`](robot/), does the work on a timer: it keeps the
list of matches in step with the feeds, locks each match's predictions on X Layer before kickoff, records
each result, publishes the opened predictions, and tells the server how each lock went. It signs with a
wallet of its own, which holds the league's circuit and a little OKB for gas.

It also speaks up when it needs a person: if its wallet runs low, or a match's predictions were not
locked in time, it opens a note on this repository, which GitHub sends on by email.

**State: live.** More in [robot/README.md](robot/README.md).

### 8. The website, kept on X Layer too

The league's account already has a site on chain, where the opened predictions go. The website's own
files can be put beside them, so Kickoff can be opened from X Layer itself, through a TapeOut
gateway that checks every file against its fingerprint. Only the wallet that holds the league's
circuit can change that copy.

The copy still talks to Kickoff's server for groups and predictions, so it is the same game at a second
address, not a game that runs with no server.

**State: built and tested, not published yet.** Its name will be `5.2.409.tape`.

## TapeOut, plainly

Kickoff is built on TapeOut, the protocol this hackathon is about. Think of TapeOut as a toolbox.
These are the tools, what each one is in plain words, and the job it does in Kickoff.

| Tool | What it is in plain words | Its job in Kickoff |
| --- | --- | --- |
| **Circuit** | A tiny rule machine. You give it facts, it gives an answer, and once it is published nobody can change it. | The scoring rules, one per sport: circuits 6, 7 and 8. Free for anyone to check. Circuit 5 is a one-gate circuit whose only job is to be the league. |
| **Processor** | The workshop a circuit is published from. | Kickoff's circuits are on processor 409, a shared one that anyone may publish on. |
| **Container** | An account that belongs to a circuit, so it can hold money and own a page. | Kickoff's own account on X Layer. Everything Kickoff says is said from it, and nothing said by any other account counts. |
| **TapeSend** | A mailbox for those accounts, where every message is stamped with who sent it and when. | The public record: each match announced, each bundle of sealed predictions locked before kickoff, each result, and each dispute. |
| **DeWEB** | A website stored on the blockchain, so it cannot be secretly changed. | Where the opened predictions are published after each match, with each player's joining time. The copy of the Kickoff site goes there too: built, not published yet. |
| **TapeKit** | The checker that opens a DeWEB site and confirms it is genuine. | How a visitor opens the copy of the site on X Layer in an ordinary browser, once it is published. |

Not used: FabX (mining), which has no role in this product, and TapeCode. Kickoff writes to TapeOut
with a small program of its own ([`robot/src/xlayer.js`](robot/src/xlayer.js)).

TapeOut already has a published draft standard for sealed forecasts, TAP-12: a claim is sealed on
chain, opened at a set time, then judged in public, so anyone can rebuild the same track record.
That document leaves scoring and leaderboards for others to build. Kickoff is that layer.

Not every part of Kickoff runs inside a circuit, and it does not need to. TapeOut is used where it
gives the guarantee: sealed predictions, a fixed scoring rule and a permanent record. The pages you click
through are an ordinary website, and the fixtures come from ordinary sports data.

## What has been checked so far

| What | How it was checked | Result |
| --- | --- | --- |
| The three scoring circuits | Every possible case, four separate ways: Kickoff's own evaluator, TapeOut's official reference evaluator, the real TapeOut contracts, and the JavaScript reader the website uses | 65,728 cases, 0 wrong ([details](docs/CHECK-RESULTS.md)) |
| The TapeOut parts | Five rehearsals and a fees report on a private copy of X Layer, against the real contracts: publishing circuits, an account and its mailbox, the on-chain site, and two whole seasons | All passed ([details](docs/REHEARSAL-RESULTS.md)) |
| The prediction engine | 137 tests. Twenty-three try to cheat, and five have the X Layer node lie about what is on chain | All pass; every cheat and every lie is refused ([details](engine/README.md)) |
| The website | 78 checks, many of them run against the real server's code, and clicked through in a browser in both light and dark | All pass ([details](web/README.md)) |
| The fixtures feed | 23 tests against saved examples, and one live run against the real feeds | All pass; the live run fetched 82 real matches ([details](feed/README.md)) |
| The server | 90 tests. They take a name somebody has, link a wallet that did not sign, send predictions in someone else's name, play old requests back, open a different prediction from the one sealed, and use the robot's addresses without its key. They also check that a match gives points only once it was locked on X Layer | All pass; every one is refused ([details](server/README.md)) |
| The robot | 65 tests, run against the server's own code: new matches, results, postponements, moved matches, a failing feed, where each key is sent, being on time for every lock, never writing twice, refusing a bundle that does not add up, a hundred players on one match, a lock it slept through, its notes when it needs a person, putting the website on X Layer, and going live without paying for anything twice | All pass ([details](robot/README.md)) |
| The robot on a copy of X Layer | The robot's own code announcing, locking, recording results and publishing opened predictions through TapeOut's real contracts, signing with `cast`, then the leaderboard rebuilt from the chain alone | 11 of 11 checks passed on the first run ([rehearsal 6](docs/REHEARSAL-RESULTS.md)) |
| What going live costs | Read from X Layer and measured on the private copy | About 0.09 OKB by the route that needs only one token ([details](docs/FEES.md)) |
| Going live for real | Done on X Layer on 24 November 2026 by the robot's wallet, after the same steps were rehearsed on the copy | It cost 0.087878 OKB, as measured. The robot's next run confirmed it was working as the league |

GitHub repeats the tests on every change, and the badges at the top of this page show the latest
results.

## Honest limits

- **It is new.** Kickoff went live on 24 November 2026 and very few people have played it. A test
  with a real group of friends is still to do.
- **One robot does the locking.** If it is late for a match, or its wallet has run dry, that
  match's predictions are not locked and nobody scores for it. The robot warns before its wallet runs
  low, but nothing stands in for it if it stops.
- **A player is one phone and browser.** The key that makes someone a player is kept in the
  browser. Linking a wallet brings their groups back on a new phone, but a wallet, once linked,
  cannot be swapped for another.
- **A result is the feed's word.** Kickoff checks that it is a result that can happen, not that it
  is true. That is why any player can dispute a result, and why a dispute can never be hidden.
- **When a player joined is Kickoff's word.** Players level on points are ordered by who joined
  first. Joining happens on Kickoff, not on X Layer, so that time cannot prove itself the way a
  prediction does. It is published on X Layer with each match's opened predictions, where anyone can read it.
- **Sealed predictions pass through Kickoff's server.** A player needs no wallet, so the server gathers
  the fingerprints and Kickoff locks them. The server never sees a prediction before kickoff and cannot
  change one or add one afterwards, but it could leave one out. Each player's receipt is the proof
  their prediction was included. The receipt is not signed yet, so Kickoff could deny having issued it.
  Signing receipts is still to do.
- **A prediction lives in the browser's storage.** If that is cleared, or the phone is lost, the secret
  is gone and that prediction can never be opened. Linking a wallet does not bring it back.
- **A brand's group has been tested with 300 players, not 5,000.** The server keeps the
  leaderboard of everyone as one list and fetches it whole each time someone looks. With thousands
  of people playing at once, the free database plan Kickoff runs on would not carry that.
- **Kickoff does not pay prizes.** A brand's group can say what the prize is. Getting it to the
  winner is between the brand and the winner.
- **The Check tab checks your group.** It confirms your group's points and their order against
  X Layer. For a brand's group that is the top twenty and you. The leaderboard of everyone can be rebuilt with the command above, but the website does
  not check it for you.
- **Kickoff's circuits sit on someone else's processor.** They are published and cannot be changed
  or removed. But publishing a new circuit there depends on that processor still selling
  transistors.
- **The copy of the website on X Layer is not published yet,** and when it is, it will still need
  Kickoff's server to play.
- **The leaderboard reader asks one X Layer node.** It checks every message against the mailbox's own
  fingerprint, but it believes that node about what the mailbox holds. TapeOut's own rule is to
  ask several nodes and require them to agree. That is still to do.
- **The free feeds have edges.** The football plan gives scores after a delay, which is fine for
  final results. It does not cover the Europa League. The WNBA is out of season, so it shows no games until its next season starts.
- **The feed's saved test examples are built from the feeds' documentation,** not captured from
  them. The live run saved the real answers, and adding those to the tests is still to do.
- **The 90-minute rule is tested against the feed's documented examples.** No test uses an answer
  saved from a real finished football match yet.
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
| 2 | The scoring circuits, and the checker that tests every possible case | Done, and published on X Layer as circuits 6, 7 and 8. |
| 3 | Proving the TapeOut parts on a private copy of X Layer | Done. Rehearsals 1 to 4 and the fees report, 29 tests against the real contracts. |
| 4 | The prediction engine and the leaderboard builder | Done, 137 tests, with a fifth rehearsal that plays a season on chain and reads it back. Still to do: asking several nodes instead of one. |
| 5 | The website's screens | Done, with real matches and real numbers. |
| 6 | Sealing a prediction for real, on the player's own device | Done. |
| 7 | The fixtures feed | Done, and running live against the real feeds. |
| 8 | Kickoff's server: groups, names, and sealed predictions until they are locked | Done, 90 tests, and online with a real database. Groups of up to 30, one name for each player, signed requests, and points only for matches that were locked on X Layer. |
| 9 | The robot: keeps the list of matches, locks predictions before kickoff and posts results on X Layer | Done and running live, 65 tests. It publishes a match's opened predictions in as many pieces as they need, tells the server how each lock went, and opens a note when its wallet runs low or a lock was missed. |
| 10 | Joining it up: real fixtures and real leaderboards on the website | Done. The League and My record screens show real numbers: a leaderboard of everyone who plays and one of your group, both numbered from 1, with every point worked out by the scoring circuits. The Check screen is read from X Layer by the player's own browser: it shows when each of your predictions was locked, works out the group's points from what is on chain, puts them beside Kickoff's own, and says whether the order is the same. |
| 11 | Going live on X Layer: the circuits and Kickoff's account | Done on 24 November 2026. The switch was rehearsed on a private copy first: a look that says the cost and sends nothing, and a go that needs the words GO LIVE. |
| 12 | The copy of the site on X Layer (DeWEB) | Built and tested: a look, a go that needs the words PUBLISH SITE, and a check that reads every file back. Not published yet. |
| 13 | A real test group with real people and real matches | Not started |
| 14 | Players with a wallet, groups run by brands, and prizes | Partly done. A player who has a wallet can link it, which costs nothing and is never required: on a new phone, linking the same wallet brings their groups back. Other players are told only that a wallet is linked, never which one. Groups run by brands are built: up to 5,000 players, started only by Kickoff, with the brand's name, a prize line and a leaderboard of the top twenty and you. Paying prizes is not started. |
| 15 | Demo video and submission | Not started |

**The scoring circuits**

| Circuit | Gates | Cases checked | Cases wrong |
| --- | --- | --- | --- |
| Football | 148 | 65,536 (every possible case) | 0 |
| Basketball | 20 | 64 (every possible case) | 0 |
| Tennis | 37 | 128 (every possible case) | 0 |

The processor address, the circuit IDs and the live link are in [Live on X Layer](#live-on-x-layer),
at the top of this page.

## Try it yourself

You need Node 22 or newer. The circuit check also needs Python 3. Nothing has to be installed.

| To do this | Run this |
| --- | --- |
| Check the scoring circuits on every possible case | `python3 circuits/check.py` |
| Run the prediction engine's tests | `cd engine && npm test` |
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
| `engine/` | The prediction engine: sealing, bundling, opening, scoring with the circuits, the leaderboard, and reading it all back from X Layer. Start with [engine/README.md](engine/README.md) |
| `feed/` | The fixtures feed: real matches and results from live sports data. Start with [feed/README.md](feed/README.md) |
| `robot/` | Kickoff's robot: keeps the list of matches in step with the feeds, and does Kickoff's work on X Layer. Start with [robot/README.md](robot/README.md) |
| `server/` | Kickoff's server: groups, names, sealed predictions until they are locked, and the leaderboards. Start with [server/README.md](server/README.md) |
| `api/`, `vercel.json` | What the web host needs: where the server starts, and where the website's files are |
| `web/` | The website. Start with [web/README.md](web/README.md) |
| `docs/` | The rules in plain words, what goes on chain, test results, rehearsal results and fees. Start with [docs/README.md](docs/README.md) |

## License

MIT
