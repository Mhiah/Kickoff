# robot

Kickoff's robot: the program that does by itself what nobody should have to do by hand.

> [!NOTE]
> **Running live:** the robot's first job. Every half hour it makes Kickoff's list of matches agree
> with the two sports feeds. Its first real run, on 24 November 2026, put 74 matches on the list
> ([the run](https://github.com/Mhiah/Kickoff/actions/runs/45319717010)).
> **Built and rehearsed, not switched on:** its work on X Layer. It locks each match's sealed picks
> before kickoff, records each result, and publishes the opened picks, through TapeOut's mailbox
> and site store. It is rehearsed on a private copy of X Layer on every change. It is switched on
> when the robot is given a wallet. 42 tests.

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
| After kickoff, and again whenever more phones have opened their picks | The file of opened picks | The league's on-chain site (DeWEB) |

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
| GitHub, in the repository's secrets | `KICKOFF_WALLET_KEY` | The wallet's private key. Handed to `cast` to sign, and to nothing else. Never printed. |
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
| `src/golive.js` | Going live: works out what is still to do on X Layer and what it costs, and does it |
| `scripts/rehearse.js` | The rehearsal on a private copy of X Layer |
| `bin/robot.js` | The commands: `fixtures` for one round on the list, `watch` to stay awake |
| `bin/golive.js` | The commands for going live: `look` and `go` |
| `test/` | The tests, run against the server's own code and stand-ins for the two feeds |

## Honest limits

- **Nothing is on X Layer yet.** The X Layer work is built and rehearsed but not switched on,
  because the robot has no wallet yet. Until it is, a match's picks are bundled on Kickoff's server
  and "Locked in" is Kickoff's word.
- **More than 32 players on one match will not fit in one file.** The league's site takes files
  of up to 24,000 bytes, and measured with the picks engine that is 32 opened picks for a match.
  That is every player who picked the match, across all groups, not one group. Past that the
  robot says so and does not publish. Splitting the file is still to do, and has to be done
  before Kickoff is opened to more than a handful of groups.
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
