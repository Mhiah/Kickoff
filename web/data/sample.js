// Made-up data, so the screens can be seen before anything is live. Every name, match and score
// here is invented. When Kickoff is live this file is replaced by what is read from X Layer.

export const COMPETITIONS = {
  pl: { name: "Premier League", sport: "football" },
  cl: { name: "Champions League", sport: "football" },
  nba: { name: "NBA", sport: "basketball" },
  wnba: { name: "WNBA", sport: "basketball" },
};

export const group = {
  name: "Sunday Ballers",
  code: "BALLERS-4821",
  you: "Bola",
  players: ["Ada", "Bola", "Funke", "Chidi", "Tunde", "Halima", "Emeka", "Dayo"],
  plays: [
    { comp: "pl", on: true, note: "10 matches this week" },
    { comp: "cl", on: true, note: "18 matches this week" },
    { comp: "nba", on: true, note: "52 games this week" },
    { comp: "wnba", on: true, note: "Out of season. Games appear when the new season starts." },
  ],
};

/** How many 3-point and 1-point picks each player has. The table is worked out from this. */
export const scores = [
  { name: "Ada", threes: 3, ones: 2 },
  { name: "Bola", threes: 2, ones: 3 },
  { name: "Funke", threes: 2, ones: 3 },
  { name: "Chidi", threes: 2, ones: 1 },
  { name: "Tunde", threes: 1, ones: 3 },
  { name: "Halima", threes: 1, ones: 2 },
  { name: "Emeka", threes: 1, ones: 1 },
  { name: "Dayo", threes: 0, ones: 2 },
];

/**
 * Matches still to be played. They are always a few days ahead of whenever the page is opened, so
 * there is always something to pick. `kickoff` is the start time in seconds.
 */
export function sampleFixtures(now) {
  const today = new Date(now * 1000);
  const at = (days, hours, minutes) =>
    Math.floor(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days, hours, minutes).getTime() / 1000);
  return {
    "rma-bay": { comp: "cl", home: "Real Madrid", away: "Bayern", kickoff: at(1, 21, 0) },
    "int-bar": { comp: "cl", home: "Inter", away: "Barcelona", kickoff: at(1, 21, 0) },
    "nyk-mil": { comp: "nba", home: "Knicks", away: "Bucks", kickoff: at(2, 1, 30) },
    "gsw-den": { comp: "nba", home: "Warriors", away: "Nuggets", kickoff: at(2, 4, 0) },
    "ars-che": { comp: "pl", home: "Arsenal", away: "Chelsea", kickoff: at(5, 18, 30) },
  };
}

/** How many matches the week holds in all. Only five are made up here. */
export const week = { total: 80 };

/** A stand-in for Kickoff's id on X Layer, until there is a real one. */
export const SAMPLE_LEAGUE = "0x0000000000000000000000c424ad6fe8a46a34fa9b0610959beaba8a2c6b6982";

/** Your own record: every match you picked that has finished. */
export const record = [
  { id: "mci-liv", comp: "pl", title: "Man City 2 – 1 Liverpool", said: "You said 1 – 0. Right winner.", points: 1 },
  { id: "lal-bos", comp: "nba", title: "Lakers beat Celtics by 7", said: "You said Lakers by 6 to 10. Spot on.", points: 3 },
  { id: "psg-ars", comp: "cl", title: "PSG 0 – 2 Arsenal", said: "You said 1 – 1.", points: 0 },
  { id: "bar-rma", comp: "cl", title: "Barcelona 1 – 1 Real Madrid", said: "You said 1 – 1. Exact score.", points: 3 },
  { id: "den-gsw", comp: "nba", title: "Nuggets beat Warriors by 12", said: "You said Nuggets by 1 to 5. Right winner.", points: 1 },
  { id: "tot-new", comp: "pl", title: "Spurs 0 – 1 Newcastle", said: "You said 1 – 2. Right winner.", points: 1 },
];
export const voided = [{ comp: "cl", title: "Napoli v Inter", said: "Postponed. Nobody scores." }];

/** One finished match in full. */
export const match = {
  id: "mci-liv",
  comp: "pl",
  home: "Man City",
  away: "Liverpool",
  score: "2 – 1",
  when: "Full time. Sunday 22 Nov, kickoff 17:30.",
  sealedAt: "17:20",
  sealedDate: "SUN 22 NOV",
  sealedCount: 8,
  opened: [
    { name: "Ada", said: "2 – 1", why: "Exact score", points: 3 },
    { name: "Bola", said: "1 – 0", why: "Right winner", points: 1 },
    { name: "Funke", said: "2 – 0", why: "Right winner", points: 1 },
    { name: "Halima", said: "3 – 1", why: "Right winner", points: 1 },
    { name: "Chidi", said: "0 – 0", why: "Wrong result", points: 0 },
    { name: "Tunde", said: "1 – 1", why: "Wrong result", points: 0 },
    { name: "Emeka", said: "1 – 2", why: "Wrong result", points: 0 },
  ],
  notOpened: ["Dayo"],
  resultFrom: "2 – 1, from the live scores feed at 19:31. Nobody typed it in.",
  dispute: { by: "Chidi", says: "0 – 0", answered: false },
  disputeUntil: "Monday 19:31",
};

/** What X Layer has on record, for the proof screen. */
export const check = {
  sealed: [
    { comp: "pl", title: "Man City 2 – 1 Liverpool", lock: "17:20", kickoff: "17:30", late: { time: "17:31", note: "One minute after kickoff, a different set of predictions was sent in. It arrived too late, so it does not count. The set sealed at 17:20 is the one that stands." } },
    { comp: "nba", title: "Lakers beat Celtics by 7", lock: "01:20", kickoff: "01:30" },
    { comp: "cl", title: "PSG 0 – 2 Arsenal", lock: "20:50", kickoff: "21:00" },
  ],
  notBelieved: [
    { title: "A result from an account that is not Kickoff's.", text: "On 22 Nov at 17:32 somebody else wrote \"0 – 0\" for Man City v Liverpool. Only Kickoff's own account can give a result, so it was ignored." },
  ],
  disputes: [{ title: "Man City 2 – 1 Liverpool.", text: "Chidi says it finished 0 – 0. Sent 22 Nov at 19:41, inside the 24 hours. Not answered yet." }],
  id: SAMPLE_LEAGUE,
};
