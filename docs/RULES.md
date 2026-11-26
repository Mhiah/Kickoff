# The rules of Kickoff, in plain words

These are the rules every league plays by. The scoring parts of this page are what the
scoring circuits in [circuits/](../circuits/) are built from, so if a rule here changes, the circuit for it has to be rebuilt
and published again as a new circuit. A circuit that is already published can never be changed.

## Rules that are the same for every sport

**Making a prediction**

- One prediction per player per match in basketball. In football a match has three predictions:
  the result, goal goal and the exact score. A player can make one, two or all three, and each
  is sealed, locked and scored by itself.
- You can change your prediction as many times as you like before the match starts. The last one you
  made before kickoff is the one that counts.
- Predictions are sealed. Nobody can see anyone else's prediction before the match starts, including the league
  host.

**Locking**

- Predictions lock at the start time written down for the match in the league.
- After that moment no prediction can be added or changed.
- A prediction only counts if it was locked on X Layer before kickoff. Kickoff's robot locks every
  match's sealed predictions there a few minutes before the start. If a match's predictions are not locked in
  time, nobody scores for that match: it gives no points and is not counted as a prediction anyone got
  wrong. The website says "Not locked in time" beside it.

**Opening**

- After the match starts, Kickoff's robot opens every prediction so everyone can see them. A player
  does not have to come back, or do anything at all, after predicting.
- To make that possible, a copy of each prediction travels with it, locked so that only the robot
  can open it, and only after the match has started. What the robot opens is checked against what
  was locked on X Layer before kickoff, so the copy cannot be used to change a prediction.
- A sealed prediction that cannot be opened scores 0 and shows on the player's record as "not opened".
- A final score is recorded once the sports feed has given the same score twice, five minutes
  apart. Once recorded, a result is never changed.
- No prediction at all scores 0.

**Scoring**

- Every prediction gives 0, 1 or 3 points.
- A basketball match gives at most 3. A football match gives at most 5: 1 for the result, 1 for
  goal goal and 3 for the exact score.
- In basketball the bonus points only count when the winner is right. A right margin with the
  wrong winner scores 0.

**Matches that do not finish**

- A match that is postponed, abandoned or ends in a walkover or a retirement is void. Nobody scores
  from it.
- If the match is played later, it is added to the league as a new match with new predictions.

## Football

**What you predict:** up to three things about each match. Make one, two or all three.

| Prediction | What you say | Points if you are right |
| --- | --- | --- |
| **Result** | How the match ends: home win, draw or away win | 1 |
| **Goal Goal** | Whether both teams score: yes or no | 1 |
| **Exact score** | The score, as home goals and away goals | 3 |

Each is scored by itself. A right result with the wrong exact score is 1 point from Result and
nothing from Exact score.

**Which score counts:** the score at the end of normal time, which is 90 minutes plus stoppage
time. Extra time and penalty shootouts do not count. A cup match that is 1-1 after 90 minutes is a
1-1 draw in Kickoff, whoever goes through.

**Examples.** The match ends 2-1 to the home team.

| You predicted | Points | Why |
| --- | --- | --- |
| Result: home win | 1 | The home team won |
| Result: draw | 0 | It was not a draw |
| Goal Goal: yes | 1 | Both teams scored |
| Goal Goal: no | 0 | Both teams scored |
| Exact score: 2-1 | 3 | Exact score |
| Exact score: 1-0 | 0 | Right winner, wrong score. The winner is what Result is for |
| All three: home win, yes, 2-1 | 5 | 1 + 1 + 3 |

Goal Goal is "no" when one team or neither scores: 1-0 and 0-0 are both "no".

**The first matches.** Until 26 November 2026 a football match had one prediction, the exact
score, which gave 3 points for the exact score and 1 for the right result with the wrong score.
Matches played under that rule keep the points it gave them.

**The limit:** each side's goals run from 0 to 15. A side that scores more than 15 is recorded
as 15.

## Basketball

**What you predict:** the winner, and how much they win by.

**Which score counts:** the final score, including overtime. A basketball match always has a
winner.

**The margin bands**

| Band | Winning margin |
| --- | --- |
| A | 1 to 5 points |
| B | 6 to 10 points |
| C | 11 to 15 points |
| D | 16 points or more |

**Points**

| Your prediction | Points |
| --- | --- |
| The right winner and the right band | 3 |
| The right winner, the wrong band | 1 |
| The wrong winner | 0 |

**Examples.** The home team wins 104-97, a margin of 7, which is band B.

| You predicted | Points | Why |
| --- | --- | --- |
| Home, band B | 3 | Right winner, right band |
| Home, band A | 1 | Right winner, wrong band |
| Away, band B | 0 | Wrong winner, so the band does not count |

## Tennis

**What you predict:** the winner, and how many sets the match takes.

**The number of sets you can prediction**

| Match type | Sets you can prediction |
| --- | --- |
| Best of 3 | 2 or 3 |
| Best of 5 | 3, 4 or 5 |

A number of sets that cannot happen in that kind of match, such as 2 sets in a best of 5, scores
0. The scoring rule itself refuses it, so it does not depend on the website stopping you.

**Points**

| Your prediction | Points |
| --- | --- |
| The right winner and the right number of sets | 3 |
| The right winner, the wrong number of sets | 1 |
| The wrong winner | 0 |

**Examples.** Player A wins a best-of-3 match in 3 sets.

| You predicted | Points | Why |
| --- | --- | --- |
| Player A in 3 | 3 | Right winner, right number of sets |
| Player A in 2 | 1 | Right winner, wrong number of sets |
| Player B in 3 | 0 | Wrong winner, so the sets do not count |

## The leaderboard

Everyone who plays is on the leaderboard, numbered from 1. Nobody shares a place.

1. Most points first.
2. Between players level on points, whoever joined Kickoff first is ahead.

So the first person to join is 1st, the next is 2nd, and a player moves up by scoring more points
than the player above them. A group's leaderboard follows the same two rules, with only the group in it.

Every player has one name, and no two players have the same name, whatever the capitals.

The leaderboard is not stored anywhere. It is worked out from the opened predictions and the results, so
anyone can work it out again and get the same leaderboard.

## Your record

Every prediction you have ever opened stays on your record with the points it scored, the misses as
well as the hits. It cannot be edited or deleted, and it is the same record in every league you
play in.

## Results and challenges

- The league host enters the result of each match.
- For 24 hours after a result is entered, any league member can challenge it by giving the score
  they say is right.
- The host then confirms the result or corrects it. In this first version the host has the final
  say.
- A challenge is never hidden. It stays on the match page for good, with what was challenged and
  how the host answered, so a host who enters a wrong result is seen doing it.

This is the one place where Kickoff still relies on a person. A live results feed is meant to
replace host-entered results later, without changing anything else in these rules.

## Free to play

Kickoff is a prediction game. Players predict, and it costs nothing to make a prediction. Prizes, where a
league has them, are paid for by the brand or community running the league.
