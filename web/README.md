# web

The Kickoff website.

> [!NOTE]
> **What is here:** every screen, in light and dark, for a phone and for a computer, drawn from
> made-up data. **Not here yet:** anything live. Pressing "Seal my pick" does not seal anything
> yet, and the matches, names and scores are invented. Each screen says so at its foot.

## The screens

| Screen | Address | What it shows |
| --- | --- | --- |
| Home | `#/` | What Kickoff is, the competitions, how a match goes |
| League | `#/league` | This week's matches, the group's table, the matches already played |
| Make a pick | `#/pick/<match>` | A score to set for football, a winner and a margin for basketball |
| Match | `#/match/<match>` | What everyone said, the result, and any dispute |
| My record | `#/record` | One player's picks and points |
| Check it yourself | `#/check` | When each set of picks was sealed, what was refused, and how to rebuild the table |
| Group | `#/group` | The invite code, the competitions the group plays, the players |

## The look

- **Georgia** for all the text. Android phones do not have Georgia, so
  [Gelasio](https://github.com/SorkinType/Gelasio), a free typeface drawn to the same measurements,
  ships with the site as the stand-in. Its licence is in [`fonts/OFL.txt`](fonts/OFL.txt).
- **Glass panels** on one plain background colour. There are no gradients anywhere, and a test
  fails if one is added.
- **Light and dark.** A visitor first sees whichever their own device is set to. The small switch
  at the end of the top row changes it, and the choice is remembered on that device.
- **A colour for each competition**, shown as a dot beside its name: pink for the Premier League,
  blue for the Champions League, yellow for the NBA, orange for the WNBA. Red is used only for
  things that were refused.

## How it is built

Plain files that a browser runs as they are: no framework, no build step, nothing to install, and
nothing loaded from anywhere else. That keeps the site small enough to publish on chain through
TapeOut's site store later, where every file has to stand on its own.

Each screen is a plain function that returns HTML as text, so the screens can be drawn and checked
without a browser.

| File | What it is |
| --- | --- |
| `index.html` | The one page. Everything else is drawn into it. |
| `styles.css` | The whole look, light and dark |
| `theme.js` | Light or dark, decided before the page is drawn so there is no flash |
| `app.js` | Which screen to show, and what the buttons do |
| `screens.js` | The screens |
| `lib/html.js` | Small pieces every screen uses: the mark, the switch, the time stamp |
| `lib/standings.js` | Turning picks into a table, with shared places |
| `data/sample.js` | The made-up data |
| `fonts/` | Gelasio and its licence |
| `test/` | The checks |

## See it on your own computer

You need Python or Node, only to serve the files.

```
cd web
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser.

## Run the checks

You need Node 22 or newer. Nothing to install.

```
node --test "web/test/*.test.js"
```

They confirm every screen draws with nothing missing, the made-up data agrees with itself, names are
made safe before they go on a page, the table's shared places are right, the styles contain no
gradient, and every screen carries the light and dark switch.
