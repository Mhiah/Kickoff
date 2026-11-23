// Made-up data, so the screens can be seen before anything is live. Every name, match and score
// here is invented. When Kickoff is live this file is replaced by what is read from X Layer.

export const COMPETITIONS = {
  pl: { name: "Premier League", sport: "football" },
  cl: { name: "Champions League", sport: "football" },
  nba: { name: "NBA", sport: "basketball" },
  wnba: { name: "WNBA", sport: "basketball" },
};

export const today = "Monday, 23 November";

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

/** Matches still to be played. `state` is "open" (no pick yet) or "sealed" (you have picked). */
export const fixtures = {
  "rma-bay": { comp: "cl", home: "Real Madrid", away: "Bayern", day: "Tuesday 24 Nov", time: "21:00", closes: "20:50", closesIn: "in 1 day 1 hour", state: "open" },
  "int-bar": { comp: "cl", home: "Inter", away: "Barcelona", day: "Tuesday 24 Nov", time: "21:00", closes: "20:50", closesIn: "in 1 day 1 hour", state: "sealed" },
  "nyk-mil": { comp: "nba", home: "Knicks", away: "Bucks", day: "Wednesday 25 Nov", time: "01:30", closes: "01:20", closesIn: "in 1 day", state: "sealed" },
  "gsw-den": { comp: "nba", home: "Warriors", away: "Nuggets", day: "Wednesday 25 Nov", time: "04:00", closes: "03:50", closesIn: "in 1 day", state: "open" },
  "ars-che": { comp: "pl", home: "Arsenal", away: "Chelsea", day: "Saturday 28 Nov", time: "18:30", closes: "18:20", closesIn: "in 4 days", state: "open" },
};

export const week = {
  total: 80,
  nextUp: "rma-bay",
  nextUpWhen: "Tomorrow, 21:00.",
  nextUpCloses: "1 day 1 hour",
  days: ["Tuesday 24 Nov", "Wednesday 25 Nov", "Saturday 28 Nov"],
};

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
    { comp: "pl", title: "Man City 2 – 1 Liverpool", lock: "17:20", kickoff: "17:30", late: { time: "17:31", note: "One minute after kickoff, a different set of picks was sent in. It arrived too late, so it does not count. The set sealed at 17:20 is the one that stands." } },
    { comp: "nba", title: "Lakers beat Celtics by 7", lock: "01:20", kickoff: "01:30" },
    { comp: "cl", title: "PSG 0 – 2 Arsenal", lock: "20:50", kickoff: "21:00" },
  ],
  notBelieved: [
    { title: "A result from an account that is not Kickoff's.", text: "On 22 Nov at 17:32 somebody else wrote \"0 – 0\" for Man City v Liverpool. Only Kickoff's own account can give a result, so it was ignored." },
  ],
  disputes: [{ title: "Man City 2 – 1 Liverpool.", text: "Chidi says it finished 0 – 0. Sent 22 Nov at 19:41, inside the 24 hours. Not answered yet." }],
  id: "0x0000000000000000000000c424ad6fe8a46a34fa9b0610959beaba8a2c6b6982",
};
