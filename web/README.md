# web

The Kickoff website.

> [!NOTE]
> **What is here:** every screen, in light and dark, for a phone and for a computer. Making a pick
> is real: pressing "Seal my pick" seals it on your own device with the picks engine, and keeps the
> pick and its secret there. **Groups are real too:** the group screen talks to Kickoff's server, so
> starting a group gives a real code and a friend can join with it from their own phone.
> **Ready, but waiting for real matches:** for a real match the phone sends the pick's fingerprint to
> the server, checks its receipt once picks are locked, and opens the pick after kickoff.
> **Not here yet:** real matches. Until the robot puts them on the server's list the site shows
> made-up ones, and a pick for one of those stays on the phone. The table and results are invented
> too. Each of those screens says so at its foot.

## The screens

| Screen | Address | What it shows |
| --- | --- | --- |
| Home | `#/` | What Kickoff is, the competitions, how a match goes |
| League | `#/league` | This week's matches, the group's table, the matches already played |
| Make a pick | `#/pick/<match>` | A score to set for football, a winner and a margin for basketball |
| Match | `#/match/<match>` | What everyone said, the result, and any dispute |
| My record | `#/record` | One player's picks and points |
| Check it yourself | `#/check` | When each set of picks was sealed, what was refused, and how to rebuild the table |
| Group | `#/group` | Start a group or join one with a code. Then: the invite code, the competitions the group plays, the players |

## The look

- **Georgia** for all the text. Android phones do not have Georgia, so
  [Gelasio](https://github.com/SorkinType/Gelasio), a free typeface drawn to the same measurements,
  ships with the site as the stand-in. Its licence is in [`fonts/OFL.txt`](fonts/OFL.txt).
- **Glass panels** on one plain background colour. There are no gradients anywhere, and a test
  fails if one is added.
- **Light and dark.** A visitor first sees whichever their own device is set to. The small switch
  at the end of the top row changes it, and the choice is remembered on that device.
- **A colour for each competition**, shown as a dot beside its name: pink for the Premier League,
  blue for the Champions League, purple for La Liga, green for Serie A, yellow for the NBA, orange for the WNBA. Red is used only for
  things that were refused.

## Making a pick

1. The first time someone picks, their device makes its own player id: 32 random bytes. There is no
   sign-up and no wallet.
2. Pressing "Seal my pick" works out the pick's fingerprint with the picks engine, using a fresh
   32-byte secret. The fingerprint covers the match, the player and the pick, as
   [engine/README.md](../engine/README.md) sets out.
3. The pick, the secret and the fingerprint are kept in that browser's own storage. Nothing is sent
   anywhere.
4. The pick screen then shows the player their own pick and the start of its fingerprint, which is
   all anyone else would see before kickoff. The league screen marks the match as sealed.

A pick can be changed until picks close, ten minutes before the start. Changing it seals it again
with a new secret, so the same pick sealed twice does not look the same from outside.

**What to know:**

- **The pick lives in the browser's storage.** If that is cleared, this phone can no longer open
  it. A pick that reached Kickoff is still opened by Kickoff's robot after kickoff, and a player
  who moved to another phone with a one-time code has the pick there too.
- **Private browsing may keep nothing.** The pick then lasts for the visit only, and the pick
  screen says so.
- **A match's id is made from its facts,** kickoff time included. If a match moves, it is a
  different match, and a pick sealed for the old one does not count for the new one.

## How it is built

Plain files that a browser runs as they are: no framework, no build step, nothing to install, and
nothing loaded from anywhere else. That keeps the site small enough to publish on chain through
TapeOut's site store later, where every file has to stand on its own.

Each screen is a plain function that returns HTML as text, so the screens can be drawn and checked
without a browser.

The site carries its own copy of the sealing code in `engine/`, because every file it uses has to
be inside this folder. The copy is made by `node web/scripts/sync-engine.js` and never edited by
hand. A test fails if it differs from the engine by a single byte.

| File | What it is |
| --- | --- |
| `index.html` | The one page. Everything else is drawn into it. |
| `styles.css` | The whole look, light and dark |
| `theme.js` | Light or dark, decided before the page is drawn so there is no flash |
| `app.js` | Which screen to show, and what the buttons do |
| `screens.js` | The screens |
| `lib/picks.js` | Sealing a pick on the device and keeping it there |
| `lib/device.js` | This device's own key, and the player id made from it |
| `lib/server.js` | Talking to Kickoff's server, with everything signed by the device's key |
| `lib/fixtures.js` | The matches to predict: real ones from the server. Made-up ones only until the list first has a real match, and never for a player in a real group |
| `lib/sync.js` | Carrying a sealed pick through: sent, receipt checked, opened after kickoff |
| `lib/move.js` | Moving a player to another phone with a one-time code |
| `lib/card.js` | The card of a finished match, drawn in the browser and saved as a picture |
| `lib/groups.js` | The groups this device plays in, kept on the device so they show at once and offline |
| `config.js` | Where Kickoff's server is |
| `lib/time.js` | Times as the screens show them, and when picks close |
| `lib/html.js` | Small pieces every screen uses: the mark, the switch, the time stamp |
| `lib/standings.js` | Turning picks into a table, with shared places |
| `engine/` | The copy of the picks engine's code for sealing, for a device's key, and for checking a receipt |
| `scripts/sync-engine.js` | Makes that copy |
| `data/sample.js` | The made-up data |
| `fonts/` | Gelasio and its licence |
| `test/` | The checks |

## See it on your own computer

You need Node 22 or newer. This runs the website together with Kickoff's server, kept in memory, so
groups work:

```
node server/bin/dev.js --matches
```

Then open `http://localhost:8787` in a browser. `--matches` puts a few made-up matches on the
server's list, the first closing in five minutes, so a pick can be followed all the way: sent,
closed, and (after the robot's part is done by hand) locked.

## No sign-up, and a wallet is optional

The first time someone plays, their phone makes its own key and keeps the private half in the
browser. That key is the player. Everything the phone sends to Kickoff is signed with it.

If the browser's saved data is cleared on the only phone holding the key, Kickoff no longer knows
who the player is. A one-time code carries the key to another phone (`lib/move.js`): the first
phone locks a copy with the code and leaves it with the server, and the other phone, given the
code, collects it and unlocks it. The server is never given the code. From then on both phones
are the same player.

## Run the checks

You need Node 22 or newer. Nothing to install.

```
node --test "web/test/*.test.js"
```

They confirm every screen draws with nothing missing, the made-up data agrees with itself, names are
made safe before they go on a page, the table's shared places are right, the styles contain no
gradient, and every screen carries the light and dark switch.

For groups, they run the website's code against the real server's code, in memory: a group is
started on one phone and joined from another, a refused join shows the server's own words, only
whoever started a group can change what it plays, a group plays at least one competition, the
private half of the key is never sent, and a phone that is offline shows what it last saw and
says so.

For a pick's journey, they follow one from a phone through the server: only the fingerprint is
sent before kickoff, a changed pick is the one that gets locked, an offline phone waits and says
so, a pick that never got through is marked as not counting, and if a changed pick never gets
through, the earlier one that did is kept so it can still be opened. Three of them have the
server cheat: it leaves a pick out, or hands back a receipt that does not prove the pick. The
phone notices each time and says so. Four more have it take a pick without properly signing for
it, and one leaves a pick out after signing: the phone is left holding Kickoff's signature. A match is only shown if the phone works out the same id
for it that the server gave.

For picks, they confirm the fingerprint is exactly the one the engine works out from the same
facts, a pick that cannot happen is refused, picks close ten minutes before the start to the
second, changing a pick gives it a new secret, picks survive the browser being reopened, damaged or
refused storage does not crash anything, and the secret is never put on a page.
