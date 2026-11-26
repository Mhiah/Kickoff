# robot

Kickoff's robot: the program that does by itself what nobody should have to do by hand.

> [!NOTE]
> **Running live:** the robot's first job. Every half hour it makes Kickoff's list of matches agree
> with the two sports feeds. Its first real run, on 24 November 2026, put 74 matches on the list
> ([the run](https://github.com/Mhiah/Kickoff/actions/runs/45319717010)).
> **Also running live, since 24 November 2026:** its work on X Layer. It locks each match's sealed
> picks before kickoff, records each result, and publishes the opened picks, through TapeOut's
> mailbox and site store. It is rehearsed on a private copy of X Layer on every change. 73 tests.

## What it does now

It runs on GitHub and does its job every half hour. Each time:

1. Fetches the coming week's matches from the two feeds: Premier League and Champions League from
   one, NBA and WNBA from the other.
2. Reads the list Kickoff's server has.
3. Works out the difference, and sends only what changed.

| What the feed says | What the robot does |
| --- | --- |
| A match that is not on the list | Adds it, unless it has already started |
| A match has finished | Records the score, and the result the way Kickoff scores it |
| A match is postponed or called off | Marks it as off. Nobody scores for it. |
| A match has been moved to another time | Adds it as a new match and calls the old one off. A match's id is made from its facts, start time included, so a moved match is a new match. |
| A different result for a match already finished | Leaves the match as it was, and says so in its report |
| Nothing new | Changes nothing and sends nothing |

If one feed is down, the other competitions carry on, and the matches it could not fetch are left
exactly as they are. Nothing is ever removed from the list.

## What it does on X Layer

Kickoff's server holds the sealed picks. What makes them impossible to change afterwards is the
record on X Layer. The robot writes that record, as the league, through TapeOut:

| When | What the robot writes | Through |
| --- | --- | --- |
| Five seconds after a match's picks close | The match is announced, then the fingerprint of its bundle of sealed picks is locked | TapeOut's mailbox (TapeSend) |
| When the feed says the match is finished, or off | The result | TapeOut's mailbox |
| Once a match has started | Nothing on chain: it fetches the locked copies of that match's picks from the server, opens each with its own key, and hands the picks back | Kickoff's server |
| After that, and again if any more picks are opened | The file of opened picks | The league's on-chain site (DeWEB) |

A lock only counts if it is on X Layer before kickoff, so this is the one job where timing
matters. The robot is awake within a second of the moment each lock becomes possible, which leaves
almost the full ten minutes. If something goes wrong it tries again every twenty seconds. If it
wakes with less than thirty seconds left it does not try, and says plainly that those picks do not
count.

Other things it is careful about:

- **A match nobody picked costs nothing.** It is never announced or locked.
- **It reads before it writes.** Starting the robot again, or running two by mistake, never writes
  the same thing twice.
- **It does not take the server's word.** It rebuilds each bundle from its entries with the picks
  engine, and refuses to lock one that does not add up to the fingerprint the server gave.
- **It does not write at all if the server and the wallet disagree about which league this is**,
  because nothing it locked could then be matched to a pick.

### The rehearsal

`scripts/rehearse.js` runs all of this on a private copy of X Layer, against TapeOut's real
contracts, with test money: the wallet becomes a league, three phones enter sealed picks through
the server's own code, the robot announces, locks, records and publishes, somebody locks a changed
bundle after kickoff, and a second robot starts with no memory. Then everything is thrown away but
the league's id, and the table is rebuilt from the chain alone. It has to come out as ada 6,
bola 2, chidi 0. The **Robot rehearsal** check on GitHub runs it on every change, signing with
`cast` exactly as the robot will for real.

Its first run on a copy of the real X Layer, on 24 November 2026, passed all 11 checks
([the run](https://github.com/Mhiah/Kickoff/actions/runs/45378783993), written up as rehearsal 6
in [docs/REHEARSAL-RESULTS.md](../docs/REHEARSAL-RESULTS.md)). Becoming a league cost 0.082 OKB
of test money, once. After that, locking two matches, recording their results and publishing their
opened picks cost 0.000014 OKB in all.

### The robot's wallet

To write to X Layer the robot needs a wallet of its own, holding a little OKB for fees:

| Where | Name | What it is |
| --- | --- | --- |
| GitHub, in the repository's secrets | `KICKOFF_WALLET_KEY` | The wallet's private key. Handed to `cast` to sign. The robot also works out from it, inside its own run, the key that opens the locked copies of picks. Never printed, and neither is that key. Only its public half is, by the "Robot's public key" workflow, for the website to lock copies to. |
| GitHub, in the repository's variables | `KICKOFF_PROCESSOR`, `KICKOFF_CIRCUIT` | Which TapeOut circuit is the league. Not secret. |

Until all three are set, nothing is written to X Layer and the robot only keeps the list up to date.

### Going live

Going live is done once, by the robot's wallet, and costs about 0.09 OKB. The wallet publishes one
small circuit on a TapeOut processor and opens its account, which makes it the league. Then it
publishes Kickoff's three scoring circuits. Kickoff uses a processor that already exists and gives
its transistors away, so everything is paid in OKB.

The **Go live on X Layer** workflow on GitHub does it, and never runs by itself:

| Choice | What it does |
| --- | --- |
| `look` | Reads X Layer and says what is still to do, what it costs, whether the wallet holds enough, and which league it would make. Sends nothing and pays nothing. |
| `go` | Does it. Runs only if the words `GO LIVE` are typed in the box. |

`go` is safe to run again after a failure. It works out what to do from what X Layer already shows
for the wallet, so a step that went through is never paid for twice. It sends nothing at all if the
wallet is short, or if the league it would make is not the one Kickoff's server is set up for.
The **Robot rehearsal** check goes live on a private copy of X Layer on every change, with a
throwaway wallet and test money.

## The website on X Layer

The league's account already has a site on chain: it is where each match's opened picks are
published. The website's own files can be put beside them, so Kickoff can be opened from X Layer
itself. This is TapeOut's DeWEB: the files live in TapeOut's site store, and a gateway reads them
from X Layer in the visitor's browser and checks each one against the fingerprint stored with it.

- **Its name is not chosen.** It is the league's circuit number, X Layer's area code and the
  processor's number: `5.2.409.tape`. A browser opens it at `https://5-2-409.tapekit.org/`.
- **It is the same site.** Every file is byte for byte the website's own, except one line of
  `config.js`, which is told the full address of Kickoff's server.
- **It still needs Kickoff's server to play.** Groups, sealed picks and the leaderboards are kept
  there. So the gateway will list Kickoff's server as something off chain the site talks to, and
  will not mark the site "100% on chain". The Check tab needs only X Layer.
- **Only the wallet that holds the league's circuit can change it.**

It is done from the **Website on X Layer** workflow, by hand, with the robot's wallet:

| | |
| --- | --- |
| `look` | Reads X Layer and says which files are still to send, what the gas will cost, and whether the wallet holds enough. Sends nothing. |
| `go` | Sends them. Runs only if the words `PUBLISH SITE` are typed in the box. |
| `check` | Reads every file back from X Layer, whole, and compares it with the files here. |

Files already on X Layer and the same are left alone, so `go` is safe to run again after a
failure, and running it after the website changes sends only what changed. The copy on X Layer
does not follow the website by itself: it changes when `go` is run.

The site's name has to be switched on with TapeOut, twelve months at a time. That was free on
X Layer when this was written. If it ever costs more than 0.01 OKB, `go` stops and says so.

The robot uses the same wallet, so `go` is best run when no match is about to start. If the two do
send at the same moment, the file that failed is started again.

## When the robot needs you

The robot works where nobody is watching, so two things are never left to pass in silence. For
each it opens a note under this repository's **Issues**, which GitHub sends on by email:

- **Its wallet is running low.** Every half hour it looks at what its wallet holds. Under
  0.01 OKB it opens one note saying how much is left, about how many matches that covers, and the
  wallet's address to send more OKB to. It does not repeat itself, and it closes the note when it
  sees the wallet topped up.
- **A match's picks were not locked in time.** If the robot was too late for a lock, or was not
  awake for it at all, it opens one note naming the match and how many sealed picks were
  affected. There is only ever one note for a match.

The robot also tells Kickoff's server how every lock went. The server gives points only for a
match it has been told was locked, so a match whose lock was missed scores for nobody, on Kickoff
as on X Layer. A robot that starts afresh reads X Layer and tells the server about any lock the
server has not heard of.

If GitHub cannot be reached the robot says so on its own page, carries on, and tries again.

## Closing picks is not the robot's job

Picks close ten minutes before kickoff. The server refuses any pick after that moment by itself,
and bundles the picks that are in by itself, the first time anyone looks at the match afterwards.
So a robot that runs late, or not at all, cannot leave a match open or unbundled.

What does depend on the robot's timing is writing each bundle's fingerprint to X Layer before
kickoff, described above.

## The robot's key

Kickoff's server takes changes to its list only from the robot. The two share one secret key:

| Where | Name |
| --- | --- |
| GitHub, in the repository's secrets | `KICKOFF_ADMIN_KEY` |
| Vercel, in the project's environment variables | `KICKOFF_ADMIN_KEY` |

The key is in neither the code nor this repository. The robot sends it only to Kickoff's own
server, in a header, and never prints it. The two feeds' keys go only to their own feeds. A test
checks each of these.

Until the key is set, a run only looks and reports. On the server's side, with no key set the
robot's addresses are switched off entirely.

## Try it

You need Node 22 or newer. Nothing has to be installed.

| To do this | Run this |
| --- | --- |
| Run the tests | `cd robot && npm test` |
| See what a run would change, without changing anything | `KICKOFF_SERVER=https://kickoff-two-xi.vercel.app FOOTBALL_DATA_KEY=… BALLDONTLIE_KEY=… node robot/bin/robot.js fixtures --dry-run` |

On GitHub, open the **Robot** workflow, choose **Run workflow**, and tick "Only say what would
change" for the same dry run. Run it with nothing ticked to wake the robot if it has stopped.
Every run's report is on its own page.

## What is in this folder

| File | What it is |
| --- | --- |
| `src/fixtures.js` | Works out what has to change on the list. No web requests, no keys. |
| `src/sync.js` | One round on the list: read the feed, read the list, send the changes, write the report |
| `src/chain.js` | Decides what has to be written to X Layer, and when. Signs and sends nothing itself. |
| `src/xlayer.js` | Reads the league's record and writes to it, through TapeOut's mailbox and site store. Also how a wallet becomes a league. |
| `src/server.js` | What the robot asks Kickoff's server for |
| `src/watch.js` | Staying awake: the half-hourly rhythm, and being on time for each lock |
| `src/notes.js` | The notes it leaves on GitHub when its wallet runs low or a lock was missed |
| `src/golive.js` | Going live: works out what is still to do on X Layer and what it costs, and does it |
| `src/site.js` | The website on X Layer: which files are still to send, sending them, and reading them back |
| `scripts/rehearse.js` | The rehearsal on a private copy of X Layer |
| `bin/robot.js` | The commands: `fixtures` for one round on the list, `watch` to stay awake |
| `bin/golive.js` | The commands for going live: `look` and `go` |
| `bin/brand.js` | Starts a group run by a brand, and prints its code |
| `bin/site.js` | The commands for the website on X Layer: `look`, `go` and `check` |
| `bin/key.js` | Prints the public key that picks are locked to. It is safe to show to anyone |
| `src/envelope.js` | The robot's key for opening the locked copies of picks after kickoff |
| `test/` | The tests, run against the server's own code and stand-ins for the two feeds |

## Honest limits

- **Nothing stands in for the robot.** If it is late for a lock, or its wallet has run dry, that
  match's picks are not locked and nobody scores for it. It warns before its wallet runs low.
- **A big match costs more to publish.** The league's site takes a file in pieces of 24,000
  bytes, about 32 opened picks to a piece, and each piece is one transaction. The robot sends as
  many pieces as the file needs, so any number of players can pick the same match. The whole file
  is sent again each time more picks have been opened, at most every ten minutes.
- **Announcing only matches that were picked** saves money, but it means a match appears on
  X Layer ten minutes before kickoff, not days before.
- **A result is the feed's word.** The robot checks it is a result that can happen, not that it is
  true. Disputes are how a wrong one gets challenged.
- **The free feeds are slow.** Scores can arrive some minutes after the final whistle, and the
  robot looks every half hour.
- **GitHub's own timer could not be relied on.** In the robot's first seven hours it did not fire
  once. So the robot keeps itself awake: one run works for about five and a half hours, then
  starts the next and stops. GitHub's timer is kept only as a safety net, to wake the robot if it
  ever stops. If both failed, the list would simply stop updating until someone pressed
  **Run workflow**. Nothing would be lost, and picks would still close on time, because the server
  does that by itself.
