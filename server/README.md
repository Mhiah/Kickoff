# server

Kickoff's server: the part that keeps the groups friends play in, and gathers everyone's sealed
picks so they can be locked on X Layer together.

> [!NOTE]
> **What is here:** the server's rules as tested code, the way a device proves it is itself, the
> addresses the website will talk to, and a version that runs on your own computer. 32 tests.
> **Not here yet:** a database (everything is kept in memory and is gone when it stops), a home on
> the internet, and the website's side of the conversation. Those are the next steps.

## Why there is a server at all

A player has no wallet and no account. Something has to gather their sealed picks and write one
lock for all of them on X Layer before kickoff. That something is this server, with the robot that
comes after it.

It is built to know as little as it can, and to be able to cheat as little as it can:

| What you might worry about | Why it cannot happen |
| --- | --- |
| The server reads my pick before kickoff | It is only ever sent the pick's fingerprint. The pick and its secret stay on your device until the match has started. |
| Someone sends a pick in my name | Everything your device sends is signed with a key that never leaves it. The server refuses anything not signed by the key your player id was made from. |
| The server changes my pick, or adds one after kickoff | The bundle is frozen ten minutes before the start and its fingerprint goes on X Layer. A changed bundle would not match it. |
| I change my pick after seeing the score | To open a pick you must give the pick and the secret that produce exactly the fingerprint that was locked. |
| The server leaves my pick out | It could. Your receipt is the proof yours was included, and you can fetch it as soon as picks are locked. |

## How a device proves it is itself

The first time someone plays, their device makes a key with two halves. The private half stays on
the device. The public half can be seen by anyone.

- A **player id** is a fingerprint of the public half, so nobody can claim an id without holding
  its key.
- Every request is **signed** with the private half. The signature covers the address the request
  is for, the time, and everything being sent, so it cannot be changed or used somewhere else.
- A request is good for five minutes. For picks, an older request never replaces a newer one, so
  nobody who overhears a request can play it back later.

The code is in [`engine/src/identity.js`](../engine/src/identity.js), because the website needs the
same code to sign as the server uses to check.

## The addresses

Anyone may ask:

| Address | What comes back |
| --- | --- |
| `GET /api/fixtures` | Every match on Kickoff's list |
| `GET /api/groups/<code>` | A group and its members |
| `GET /api/matches/<match>` | How many picks are in. After the start: who sealed one, and the picks that have been opened |
| `GET /api/matches/<match>/receipt/<player>` | A player's proof their sealed pick was locked |
| `GET /api/matches/<match>/openings` | The file of opened picks, in the form the picks engine reads |

A device must sign these:

| Address | What it does |
| --- | --- |
| `POST /api/groups` | Start a group, and get its code |
| `POST /api/groups/<code>/join` | Join a group with a name |
| `POST /api/groups/<code>/plays` | Choose which competitions it plays. Only the person who started it can |
| `POST /api/me/groups` | The groups this device is in |
| `POST /api/picks` | Send a sealed pick. Sending again before picks close replaces it |
| `POST /api/picks/mine` | What the server holds for this device |
| `POST /api/opened` | Open a pick, after the match has started |

Only Kickoff's robot may use these, with a key of its own:

| Address | What it does |
| --- | --- |
| `POST /api/admin/fixtures` | Put the feed's matches on the list, and update their state |
| `POST /api/admin/freeze/<match>` | Close a match's picks for good and bundle them |

When the server will not do something, it says why in plain words, for example "Picks for this
match have closed."

## What the tests try

| What is tried | What happens |
| --- | --- |
| Sending a pick with another player's id written inside it | It is taken as the sender's own pick. The other player's is untouched. |
| Swapping the fingerprint inside someone's signed request | Refused: the signature does not match. |
| Sending a request with no signature | Refused. |
| Playing back an earlier pick over a later one | Refused: a newer pick is already in. |
| Sending a pick one second after picks close | Refused. One second before, it is accepted. |
| Using a request signed for one address at another | Refused. |
| Opening a different pick from the one sealed | Refused. |
| Opening with someone else's pick and secret | Refused. |
| Opening before the match starts | Refused. |
| Making a bundle after kickoff | Refused, because it could never count. |
| Slipping a pick into storage after the bundle is frozen | The bundle does not change. |
| Using the robot's addresses with a guessed key, or a player's signature | Refused. |
| Moving a match's start time under the same id | Refused: a moved match is a new match. |

One test goes the whole way: three phones seal picks for a football match and a basketball match,
the server bundles them, the locks and results are written the way the robot will write them, the
phones open their picks, and the picks engine rebuilds the table from that record alone. The table
comes out right, including a player who never opened a pick and scores nothing for it.

## Try it

You need Node 22 or newer. Nothing has to be installed.

| To do this | Run this |
| --- | --- |
| Run the tests | `cd server && npm test` |
| Run the server on your own computer, with the website | `node server/bin/dev.js`, then open `http://localhost:8787` |

Run this way, everything is kept in memory and is gone when it stops.

## What is in this folder

| File | What it is |
| --- | --- |
| `src/kickoff.js` | The rules: groups, sealed picks, freezing, receipts, opening |
| `src/http.js` | The addresses, and who may use each |
| `src/store.js` | Where things are kept. For now, in memory |
| `bin/dev.js` | The server on your own computer |
| `test/` | The tests |

## Honest limits

- **Nothing is kept yet.** The database is the next step.
- **The website does not talk to it yet.** A sealed pick still stays on the device.
- **A receipt is not signed.** Kickoff could deny having issued one. Signing receipts is still to do.
- **The server could leave a pick out of a bundle.** A player can check for their receipt as soon as
  picks are locked, but by then it is too late to add the pick. This is the one thing a player has
  to trust the server for, and it is said plainly here.
- **A group's code is all that guards it.** Anyone with the code can see the group and join it.
- **Nothing limits how often a device can ask.** That comes with putting it on the internet.
