# feed

Kickoff's fixtures feed: the code that fetches real matches and their results, so nobody has to
type them in.

> [!NOTE]
> **What is here:** readers for both feeds, the rules for turning a feed's result into a Kickoff
> result, a command that prints a week's fixtures, and 22 tests that run against saved examples
> with no key. **Not here yet:** anything that puts these matches on the website or on X Layer.
> That is the server and the robot, which come next.

## What it covers

| Competition | Sport | Feed |
| --- | --- | --- |
| Premier League | Football | [football-data.org](https://www.football-data.org), version 4 |
| Champions League | Football | football-data.org |
| NBA | Basketball | [balldontlie](https://www.balldontlie.io) |
| WNBA | Basketball | balldontlie |

Both feeds have a free plan, and both need a key, which is free with an account.

## What comes out

Every match is put into one shape, whichever feed it came from:

| Part | What it is |
| --- | --- |
| `feedId` | The feed's own name for the match. It stays the same if the match is moved. |
| `comp` | `pl`, `cl`, `nba` or `wnba` |
| `home`, `away` | The two sides, by the short names people use |
| `kickoff` | The start time, in seconds |
| `label` | The text that goes into the match's id, such as `Premier League: Arsenal v Chelsea` |
| `state` | `scheduled`, `live`, `final`, `void` or `unknown` |
| `score` | The score as the feed gave it, for showing |
| `result`, `resultByte` | The result as Kickoff scores it, and that result as the one byte the scoring circuit takes. Only when `final`. |
| `note` | Why a match is void or unknown, in plain words |

## How a feed's result becomes a Kickoff result

**Football**

- The result is **the score after 90 minutes**. For a match that went to extra time or penalties,
  the feed gives the 90-minute score separately, and that is the one used. Its full-time line there
  includes the extra-time goals and the penalties, so it is not used.
- A side that scores more than 15 is recorded as 15, as [the rules](../docs/RULES.md) say.
- Postponed and called-off matches are **void**: nobody scores. So is a match whose result was
  awarded by a committee, because that is not a result anybody predicted.
- A match **suspended** part way is not void yet. It may be finished later, so it waits.

**Basketball**

- The result is **the winner and the winning margin** from the final score, overtime included.
- Postponed, called-off and abandoned games are **void**. Delayed and suspended games wait.

**Never guessed.** If a feed says a match finished but gives no score, or a basketball game
finished level, or a match went to extra time and the 90-minute score is missing, the match is
marked `unknown` with the reason. It gets no result until a person has looked.

**Never hidden.** A match the feed describes badly (no start time, a side with no name) is left
out and listed under problems. If one feed fails, the other still runs, and the failure is listed.

## See this week's fixtures

You need Node 22 or newer and the two keys. Nothing to install.

```
FOOTBALL_DATA_KEY=your-key BALLDONTLIE_KEY=your-key node feed/bin/fixtures.js
```

It prints each competition's matches for the next seven days, with results for any that have
finished, and then anything that went wrong. `--from` and `--to` choose other days, and `--json`
prints everything as JSON.

The keys are read from the environment and sent only to the feed they belong to. They are never
printed, saved, or put in an address.

## Run the tests

```
cd feed
npm test
```

They need no key and no network. They cover a match that has not started, a normal result, extra
time, penalties (using the feed's own documented example), a postponed, called-off, awarded and
suspended match, a 17 – 0, overtime, every winning-margin band, paging through the NBA's answer,
the WNBA naming things differently, a refused key, a competition outside the plan, too many
requests, and one feed failing while the other works. They also put a feed result through the real
scoring circuits and check the points.

## Honest limits

- **The saved examples are built from the feeds' documentation,** not captured from the feeds.
  Each one that is copied from the documentation is marked. Real answers will be saved from the
  first live run and added to the tests.
- **A result is the feed's word.** Kickoff checks it is a result that can happen, not that it is
  true. That is why any player can dispute a result.
- **The free football plan gives scores after a delay.** That is fine for final results, which is
  all Kickoff needs.
- **A team's name comes from the feed.** If a feed renames a team, the label changes, so the robot
  will fix a match's label at the moment it announces the match.

## The files

| File | What it is |
| --- | --- |
| `src/shape.js` | The one shape every match is put into, and the checks on it |
| `src/football.js` | Reading football-data.org |
| `src/basketball.js` | Reading balldontlie, for both leagues |
| `src/week.js` | All four competitions for a stretch of days |
| `bin/fixtures.js` | The command that prints the fixtures |
| `test/examples.js` | Saved examples of what each feed sends |
| `test/feed.test.js` | The tests |
