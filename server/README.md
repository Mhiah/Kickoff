# server

Kickoff's server: the part that keeps the groups friends play in, and gathers everyone's sealed
picks so they can be locked on X Layer together.

> [!NOTE]
> **What is here:** the server's rules as tested code, the way a device proves it is itself, the
> addresses the website will talk to, the connection to a real database, the entry point a web
> host uses, and a version that runs on your own computer. 75 tests.
> **Online** at <https://kickoff-two-xi.vercel.app> (every address under `/api/`), with a real
> database. Starting a group, joining it, a changed request and a keyless robot request have all
> been tried on the live server, and each behaved as the tests say.
> The website uses it for groups.
> **Not here yet:** the website does not send sealed picks to it, and no real matches are on its
> list until the robot is built. Those are the next steps.

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
| The server leaves my pick out | It could, but not quietly. It signs a note for every sealed pick it takes, and your phone keeps it: Kickoff's own signature that yours was handed in on time. Your receipt is the proof yours was included, and you can fetch it as soon as picks are locked. |

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

## Names, points and the tables

Every player has one name, the same in every group, and no two players have the same one whatever
the capitals. A name is claimed in one step, so two people asking for it at the same moment cannot
both get it. Changing a name frees the old one.

A pick only counts if its match's sealed picks were locked on X Layer before kickoff. The robot
does the locking and tells the server how it went for each match: locked, or missed. So a pick
scores once three things are true: the match was locked, it has a result, and the pick has been
opened. Whichever happens last does the scoring. A match whose lock was missed never scores for
anyone, any points already given for it are taken back, and each player who picked it is shown
why. This keeps Kickoff's own tables the same as the ones anyone can rebuild from X Layer. The points come from Kickoff's scoring circuits, the same ones that are
published on X Layer, which the server carries as text in `src/circuits.js`. A test fails if that
copy ever differs from the published files.

There are two tables, both numbered from 1 with nobody sharing a place: everyone who plays, and
one group. Most points first, and between players level on points, whoever joined Kickoff first.
Only the top twenty of the table of everyone is sent, with the asking player's own row added if
they are further down. A row carries a name and numbers and nothing else about the player.

## Groups run by a brand

A group of friends holds 30 players and anyone can start one. A group run by a brand holds up to
5,000, and only Kickoff can start one, with its own key. It carries the brand's name, which players
see as "Run by …", and an optional line about the prize. Nobody in it started it, so nobody in it
can change which competitions it plays.

A group that size is never listed member by member. Anyone with the code is told what the group is
and how many are in it. A player in it is also given their own seat, and nobody else's. Its
leaderboard is the top twenty and the asking player's own row, found from a mark kept on each
person, so the list of members is never fetched whole. A test with 300 players checks that.

The **Make a brand group** workflow on GitHub starts one and shows its code.

## Linking a wallet

Nobody needs a wallet to play. A player who has one can link it, and it costs nothing: the wallet
signs a short note that names the player, and the server checks the signature. Nothing is paid and
nothing is sent to any chain.

- **It is a way back in.** A new phone that links the same wallet takes the same seat, under the
  same name, in every group the wallet's other devices are in.
- **One wallet, one seat, one pick.** A wallet's devices share a seat in a group. If two of them
  send a pick for the same match, the later one replaces the earlier one.
- **Other players are told only that a seat has a wallet linked.** Which wallet it is goes to the
  player's own device and to nobody else.
- **Only the wallet can link itself.** The note names the player and the time, so a note signed for
  one player is no use to another, and an old one is refused after fifteen minutes.

The check is in [`engine/src/wallet.js`](../engine/src/wallet.js). It reads a signature and works
out which wallet made it. It never signs anything and never handles a private key. Its tests read
back signatures made by Node's own cryptography and one published in web3.js's documentation.

## The addresses

Anyone may ask:

| Address | What comes back |
| --- | --- |
| `GET /api/fixtures` | Every match on Kickoff's list |
| `GET /api/key` | The public key the server signs with. Safe to show to anyone |
| `GET /api/groups/<code>` | A group and its members |
| `GET /api/matches/<match>` | How many picks are in. After the start: who sealed one, and the picks that have been opened |
| `GET /api/matches/<match>/receipt/<player>` | A player's proof their sealed pick was locked |
| `GET /api/matches/<match>/openings` | The file of opened picks, in the form the picks engine reads |

A device must sign these:

| Address | What it does |
| --- | --- |
| `POST /api/groups` | Start a group, choosing what it plays, and get its code |
| `POST /api/groups/<code>/join` | Join a group with a name |
| `POST /api/groups/<code>/plays` | Choose which competitions it plays. Only the person who started it can |
| `POST /api/me/groups` | The groups this device is in, and the wallet it has linked, if any |
| `POST /api/me/table` | The League screen's numbers: the table of everyone, the table of a group, and this player's place and finished matches |
| `POST /api/wallet` | Link a wallet: its address, the note's time, and its signature of the note |
| `POST /api/move` | Leave a locked copy of this phone's key for another phone to collect with a one-time code. Held for ten minutes |
| `POST /api/move/take` | Collect it. Handed over once, then gone. Five wrong tries and a phone has to wait |
| `POST /api/picks` | Send a sealed pick. Sending again before picks close replaces it |
| `POST /api/picks/mine` | What the server holds for this device |
| `POST /api/opened` | Open a pick, after the match has started. The robot does this for every pick, so a phone only does it for a pick that was sent without a locked copy |

Only Kickoff's robot may use these, with a key of its own:

| Address | What it does |
| --- | --- |
| `POST /api/admin/fixtures` | Put the feed's matches on the list, and update their state |
| `POST /api/admin/freeze/<match>` | A match's bundle, once picks have closed. The server makes the bundle by itself; this is how the robot asks for it |
| `POST /api/admin/brand-groups` | Start a group run by a brand: its name, the brand, an optional prize line and which competitions it plays |
| `POST /api/admin/locks` | How locking on X Layer went for some matches: `locked` or `missed`. Only locked matches give points |

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
| Nobody asking for a bundle until after kickoff | The bundle is still exactly the picks that were in when picks closed. |
| Slipping a pick into storage after the bundle is frozen | The bundle does not change. |
| Using the robot's addresses with a guessed key, or a player's signature | Refused. |
| Moving a match's start time under the same id | Refused: a moved match is a new match. |
| Making a bundle while picks are still open | Refused. A bundle is made a few seconds after picks close. |
| Two groups started at the same moment | They can never be given the same code. |
| Starting a group that plays nothing, or switching off its last competition | Refused: a group plays at least one. |
| The database failing, or its token being wrong | The player is told something went wrong. Nothing about the database is shown. |

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

## The database, and going on the internet

The server keeps very little: single values, and small tables. Online it keeps them in a Redis
database, the kind Vercel offers through its Marketplace, spoken to with plain web requests so
there is still nothing to install. Every database test is run twice, once against the in-memory
store and once against a stand-in for the real one, so the two are known to behave the same.

The host's settings decide everything. None of them is in the code:

| Setting | What it is |
| --- | --- |
| `KV_REST_API_URL` and `KV_REST_API_TOKEN` | The database's address and token. Vercel adds these itself when a database is connected. |
| `KICKOFF_ADMIN_KEY` | The robot's key. If it is not set, the robot's addresses are switched off. The key the server signs with is worked out from it, so without it nothing is signed. |
| `KICKOFF_LEAGUE` | Kickoff's id on X Layer. Until Kickoff is live there, a stand-in is used. |

Every record's name starts with `kickoff:`, so the database can be shared with another project
without either overwriting the other.

With no database set, every address answers "Kickoff's database is not connected yet." It never
pretends to keep things it would forget.

`vercel.json` at the top of the repo tells Vercel to serve the website from `web/` and to pass
every `/api/...` address to `api/index.mjs`, which starts the server.

**A browser on any site may ask this server.** That is what lets the copy of the website kept on
X Layer, which a browser opens at another address, play the same game. It gives nothing away: a
player is known by a signature made with a key their own browser holds, never by a cookie, so a
page on another site has nothing of theirs to use. The robot's key travels in a header a browser
is not allowed to send from another site.

## What is in this folder

| File | What it is |
| --- | --- |
| `src/kickoff.js` | The rules: groups, sealed picks, freezing, receipts, opening |
| `src/signing.js` | The key the server signs with, worked out from the key it already holds |
| `src/http.js` | The addresses, and who may use each |
| `src/store.js` | Keeping things in memory, for the tests and your own computer |
| `src/redis-store.js` | Keeping things in the real database |
| `src/web.js` | The server as a web host runs it, built from the host's settings |
| `bin/dev.js` | The server on your own computer |
| `bin/key.js` | Prints the public key the server signs with |
| `test/` | The tests |

## Honest limits

- **Sealed picks have not been tried on the live server.** They need real matches on its list,
  which the robot will put there. Groups have been tried.
- **The database is shared** with another of the owner's projects, on a free plan. Kickoff's
  records are kept apart by their names.
- **The website only uses it for groups so far.** A sealed pick still stays on the device.
- **The server could leave a pick out of a bundle.** A player can check for their receipt as soon as
  picks are locked, but by then it is too late to add the pick. What the player does hold is the
  note the server signed when it took the pick, so Kickoff cannot deny having been given it. The
  key it signs with is worked out from `KICKOFF_ADMIN_KEY`: if that is ever changed, `SERVER_KEY`
  in `web/config.js` has to be changed to match, and the "Server's public key" action prints it.
- **The server's table is not yet checked against X Layer on the website.** The points come from
  the published circuits, but the Check screen that rebuilds the table from X Layer is still to do.
- **The table of everyone is worked out again whenever anything changes.** That is fine for
  hundreds of players and will want rethinking for many thousands.
- **A linked wallet cannot be changed or taken off yet.** A device links one wallet, once.
- **Wallets that are themselves contracts cannot link.** Only an ordinary wallet's signature is read.
- **The robot's key could open a pick early.** With each fingerprint a phone sends a copy of the
  pick locked to the robot's public key (`engine/src/envelope.js`). The server stores the copy but
  cannot read it, and it hands copies out only to the robot, and only after the match has started
  (`GET /api/admin/envelopes/<match>`, refused before kickoff). The robot opens them and hands each
  pick back (`POST /api/admin/opened`), where it is checked against the locked fingerprint like any
  other. So nobody has to come back after a match, and a lost phone loses nothing. The price is
  that the server and the robot together could read a pick before kickoff. They are kept apart,
  but both are Kickoff's. Neither can change a pick.
- **A group's code is all that guards it.** Anyone with the code can see the group and join it.
- **Nothing limits how often a device can ask.** That comes with putting it on the internet.
