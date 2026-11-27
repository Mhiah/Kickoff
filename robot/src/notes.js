// Telling the person who runs Kickoff that the robot needs her.
//
// The robot works where nobody is watching, so two things must not pass in silence:
//
//   the wallet running low   every lock, result and file costs a little gas. If the wallet runs
//                            dry the robot cannot lock picks before kickoff.
//   a lock that was missed   picks that were sealed but never locked on X Layer before kickoff.
//
// For each it opens a note on the project's page on GitHub (an "issue"), which GitHub sends on by
// email. A note is never opened twice: one about the wallet stays open until the wallet is topped
// up, when the robot closes it itself, and there is only ever one note for each missed match.
//
// Nothing here can stop the robot. If GitHub cannot be reached, the robot says so on its own page
// and carries on.

/** Below this the wallet is low: 0.01 OKB. */
export const LOW_WALLET = 10n ** 16n;
/** About what one match costs when a full group of 32 picked it and their file is sent three times (docs/FEES.md). */
export const A_FULL_MATCH = 370_000_000_000_000n;
export const WALLET_TITLE = "The robot's wallet is running low";

export const inOkb = (wei) => `${(Number(wei / 10n ** 12n) / 1e6).toFixed(4)} OKB`;
/** Roughly how many matches a balance covers, counting every one as a full match. */
export const matchesLeft = (wei) => Number(wei / A_FULL_MATCH);

/** The note about the wallet. */
export function walletNote({ balance, wallet, owner }) {
  return {
    title: WALLET_TITLE,
    body: [
      `${owner ? `@${owner} ` : ""}the robot's wallet on X Layer is down to **${inOkb(balance)}**.`,
      "",
      `That is enough for about **${matchesLeft(balance)} more matches** if each is predicted by a full group, and more if the groups are small. When it runs out, the robot cannot lock predictions before kickoff.`,
      "",
      "**What to do:** send OKB, on X Layer, to the robot's wallet:",
      "",
      `\`${wallet}\``,
      "",
      "0.05 OKB is plenty. Send it from your own wallet yourself. Nobody else needs to do anything, and the robot will close this note once it sees the money.",
    ].join("\n"),
  };
}

/** The note about a match whose picks were not locked in time. Only ever written once for a match. */
export function missedNote({ label, kickoff, count, owner }) {
  const day = new Date(kickoff * 1000).toISOString().slice(0, 16).replace("T", " ");
  return {
    title: `Not locked in time: ${label}, ${day.slice(0, 10)}`,
    once: true,
    body: [
      `${owner ? `@${owner} ` : ""}the robot did not get the sealed predictions for **${label}** (kickoff ${day} UTC) locked on X Layer before kickoff.`,
      "",
      `**${count} sealed ${count === 1 ? "pick was" : "picks were"} affected.** Nothing on X Layer shows they were made before the match started, so they cannot be checked there.`,
      "",
      "The robot's own page for that time says what went wrong: Actions, then Robot, then the run from that hour.",
    ].join("\n"),
  };
}

/**
 * Notes on a GitHub repository.
 * @param repo   "owner/name"
 * @param token  the token GitHub hands a workflow, allowed to write issues
 */
export function createNotes({ repo, token, fetch = globalThis.fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "") || !token) return null;
  const api = async (method, path, body) => {
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "kickoff-robot", ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    return response.json();
  };
  const withTitle = async (title) => (await api("GET", "/issues?state=all&per_page=100")).filter((i) => !i.pull_request && i.title === title);
  return {
    owner: repo.split("/")[0],
    /**
     * Open a note, unless one with this title is open already (or, with `once`, was ever opened).
     * @returns true if a note was opened
     */
    async raise({ title, body, once = false }) {
      if ((await withTitle(title)).some((i) => once || i.state === "open")) return false;
      await api("POST", "/issues", { title, body });
      return true;
    },
    /**
     * Close the open notes with this title, saying why.
     * @returns true if there was one to close
     */
    async settle({ title, words }) {
      const open = (await withTitle(title)).filter((i) => i.state === "open");
      for (const i of open) {
        await api("POST", `/issues/${i.number}/comments`, { body: words });
        await api("PATCH", `/issues/${i.number}`, { state: "closed" });
      }
      return open.length > 0;
    },
  };
}

/**
 * Keeps an eye on the wallet. Call what it returns as often as you like: it only speaks, and only
 * writes a note, when the wallet goes from fine to low or back.
 * @param balance  a function giving what the wallet holds, in wei
 * @param wallet   the wallet's address, for the note
 * @param notes    from createNotes(), or null to only say it on the robot's own page
 * @param say      where to write what happened
 * @returns an async function giving "low", "fine", or null if the wallet could not be read
 */
export function walletWatch({ balance, wallet, notes, low = LOW_WALLET, say = () => {} }) {
  let settled = null; // the last state that was dealt with in full
  return async function look() {
    let wei;
    try {
      wei = await balance();
    } catch {
      return null; // X Layer could not be read this time. The next look will do.
    }
    const state = wei < low ? "low" : "fine";
    if (state === settled) return state;
    try {
      if (state === "low") {
        say(`PROBLEM: the robot's wallet is down to ${inOkb(wei)}, enough for about ${matchesLeft(wei)} more full matches. It needs topping up.`);
        if (notes && (await notes.raise(walletNote({ balance: wei, wallet, owner: notes.owner })))) say("A note about the wallet was opened on GitHub.");
      } else if (notes && (await notes.settle({ title: WALLET_TITLE, words: `The wallet holds ${inOkb(wei)} again, so the robot closed this note.` }))) {
        say(`The wallet holds ${inOkb(wei)} again. The note about it was closed.`);
      }
      settled = state;
    } catch (error) {
      say(`The note about the wallet could not be written (${error.message}). It will be tried again.`);
    }
    return state;
  };
}

/**
 * Write a note for each match whose picks were not locked in time.
 * @param missed  from chainTick(): [{ label, kickoff, count }]
 * @returns the ones that could not be noted, to be tried again
 */
export async function noteMissed({ missed, notes, say = () => {} }) {
  const left = [];
  for (const m of missed) {
    if (!notes) continue;
    try {
      if (await notes.raise(missedNote({ ...m, owner: notes.owner }))) say(`A note about ${m.label} not being locked in time was opened on GitHub.`);
    } catch (error) {
      say(`The note about ${m.label} could not be written (${error.message}). It will be tried again.`);
      left.push(m);
    }
  }
  return left;
}

/** The note for a finished result the feed has since changed. Kickoff keeps the first one. */
export function changedNote({ label, from, to, owner }) {
  return {
    title: `The feed changed a result: ${label}, ${from} to ${to}`,
    once: true,
    body: [
      `${owner ? `@${owner} ` : ""}the sports feed has changed the result of **${label}** after Kickoff recorded it.`,
      "",
      `Kickoff recorded **${from}**. The feed now says **${to}**.`,
      "",
      "**Kickoff has kept the first result.** A result, once recorded, is never changed by the robot, so that nobody can alter one after the fact. The points for this match were worked out from the first result.",
      "",
      "**What to do:** look up the real score. If the first result was right, there is nothing to do. If it was wrong and the match's predictions were never locked on X Layer, nobody's points came from it: run the **Correct a result** action, which puts it right to what the feed says now. If its predictions were locked, the match needs a person to decide what happens to its points.",
    ].join("\n"),
  };
}

/**
 * Open a note for each finished result the feed has changed. Each is noted once. Returns the ones
 * whose note could not be written, to try again on the next round.
 */
export async function noteChanged({ changed, notes, say = () => {} }) {
  const left = [];
  for (const c of changed) {
    if (!notes) continue;
    try {
      if (await notes.raise(changedNote({ ...c, owner: notes.owner }))) say(`A note about the feed changing the result of ${c.label} was opened on GitHub.`);
    } catch (error) {
      say(`The note about ${c.label} could not be written (${error.message}). It will be tried again.`);
      left.push(c);
    }
  }
  return left;
}
