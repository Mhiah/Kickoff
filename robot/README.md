# robot

Kickoff's robot: the program that does by itself what nobody should have to do by hand.

> [!NOTE]
> **What is here:** the robot's first job. Every half hour it makes Kickoff's list of matches agree
> with the two sports feeds. 14 tests. **It is running live:** its first real run, on 24 November
> 2026, put 74 matches on the list ([the run](https://github.com/Mhiah/Kickoff/actions/runs/45319717010)).
> **Not here yet:** its jobs on X Layer: announcing each match, locking each match's picks before
> kickoff, and posting each result. Those are built next and rehearsed on a private copy of
> X Layer before they touch the real thing.

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

## Closing picks is not the robot's job

Picks close ten minutes before kickoff. The server refuses any pick after that moment by itself,
and bundles the picks that are in by itself, the first time anyone looks at the match afterwards.
So a robot that runs late, or not at all, cannot leave a match open or unbundled.

What will depend on the robot's timing is writing each bundle's fingerprint to X Layer before
kickoff. That is the next piece.

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
| `src/sync.js` | One run: read the feed, read the list, send the changes, write the report |
| `bin/robot.js` | The command |
| `test/` | The tests, run against the server's own code and stand-ins for the two feeds |

## Honest limits

- **Nothing is on X Layer yet.** A match's picks are bundled on Kickoff's server, and the bundle's
  fingerprint is not yet written anywhere Kickoff cannot change it. Until the next piece is live,
  "Locked in" is Kickoff's word.
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
