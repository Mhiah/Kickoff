// Examples of what the two feeds send, for the tests.
//
// They are shaped exactly as each feed's documentation shows (football-data.org version 4, and
// balldontlie's NBA and WNBA pages), read on 23 November 2026. Where the documentation prints an
// example, that example is used as it is and marked "from the documentation". The rest are
// made-up matches in the same shape, to cover the cases a real week throws up.

const team = (id, name, shortName, tla) => ({ id, name, shortName, tla, crest: `https://crests.football-data.org/${id}.png` });
const ARS = team(57, "Arsenal FC", "Arsenal", "ARS");
const CHE = team(61, "Chelsea FC", "Chelsea", "CHE");
const MCI = team(65, "Manchester City FC", "Man City", "MCI");
const LIV = team(64, "Liverpool FC", "Liverpool", "LIV");
const TOT = team(73, "Tottenham Hotspur FC", "Tottenham", "TOT");
const NEW = team(67, "Newcastle United FC", "Newcastle", "NEW");
const RMA = team(86, "Real Madrid CF", "Real Madrid", "RMA");
const BAY = team(5, "FC Bayern München", "Bayern", "FCB");
const ATM = team(78, "Club Atlético de Madrid", "Atleti", "ATL");
const PSG = team(524, "Paris Saint-Germain FC", "PSG", "PSG");

const footballMatch = (id, utcDate, status, homeTeam, awayTeam, score = {}) => ({
  area: { id: 2072, name: "England", code: "ENG" },
  id,
  utcDate,
  status,
  matchday: 13,
  stage: "REGULAR_SEASON",
  group: null,
  lastUpdated: "2026-11-23T08:00:00Z",
  homeTeam,
  awayTeam,
  score: { winner: null, duration: "REGULAR", fullTime: { home: null, away: null }, halfTime: { home: null, away: null }, ...score },
});

export const premierLeague = {
  filters: { dateFrom: "2026-11-21", dateTo: "2026-11-30" },
  resultSet: { count: 9, first: "2026-11-21", last: "2026-11-30", played: 3 },
  competition: { id: 2021, name: "Premier League", code: "PL", type: "LEAGUE" },
  matches: [
    footballMatch(538001, "2026-11-22T16:30:00Z", "FINISHED", MCI, LIV, { winner: "HOME_TEAM", fullTime: { home: 2, away: 1 }, halfTime: { home: 1, away: 0 } }),
    footballMatch(538002, "2026-11-28T17:30:00Z", "TIMED", ARS, CHE),
    footballMatch(538003, "2026-11-29T14:00:00Z", "SCHEDULED", TOT, NEW),
    footballMatch(538004, "2026-11-23T20:00:00Z", "IN_PLAY", NEW, ARS, { fullTime: { home: 1, away: 1 } }),
    footballMatch(538005, "2026-11-21T15:00:00Z", "POSTPONED", CHE, TOT),
    footballMatch(538006, "2026-11-21T15:00:00Z", "CANCELLED", LIV, NEW),
    footballMatch(538007, "2026-11-21T12:30:00Z", "SUSPENDED", TOT, MCI, { fullTime: { home: 0, away: 1 } }),
    footballMatch(538008, "2026-11-21T15:00:00Z", "AWARDED", ARS, LIV, { winner: "HOME_TEAM", fullTime: { home: 3, away: 0 } }),
    footballMatch(538009, "2026-11-21T17:30:00Z", "FINISHED", MCI, CHE, { winner: "HOME_TEAM", fullTime: { home: 17, away: 0 } }),
  ],
};

export const championsLeague = {
  filters: { dateFrom: "2026-11-21", dateTo: "2026-11-30" },
  resultSet: { count: 4 },
  competition: { id: 2001, name: "UEFA Champions League", code: "CL", type: "CUP" },
  matches: [
    footballMatch(551001, "2026-11-24T20:00:00Z", "TIMED", RMA, BAY),
    // Went to extra time: 2 – 2 after 90 minutes, 3 – 2 after 120.
    footballMatch(551002, "2026-11-21T20:00:00Z", "FINISHED", ATM, PSG, {
      winner: "HOME_TEAM", duration: "EXTRA_TIME", fullTime: { home: 3, away: 2 }, halfTime: { home: 1, away: 1 }, regularTime: { home: 2, away: 2 }, extraTime: { home: 1, away: 0 },
    }),
    // From the documentation ("Dealing with scores"), which still names the sides the older way.
    footballMatch(551003, "2026-11-21T20:00:00Z", "FINISHED", PSG, BAY, {
      winner: "HOME_TEAM", duration: "PENALTY_SHOOTOUT", fullTime: { homeTeam: 7, awayTeam: 6 }, halfTime: { homeTeam: 1, awayTeam: 1 },
      regularTime: { homeTeam: 1, awayTeam: 1 }, extraTime: { homeTeam: 0, awayTeam: 0 }, penalties: { homeTeam: 6, awayTeam: 5 },
    }),
    // Went to extra time, but the 90-minute score is missing.
    footballMatch(551004, "2026-11-21T20:00:00Z", "FINISHED", RMA, ATM, { winner: "AWAY_TEAM", duration: "EXTRA_TIME", fullTime: { home: 1, away: 2 } }),
  ],
};

const nbaTeam = (id, city, name, abbreviation) => ({ id, conference: "East", division: "Atlantic", city, name, full_name: `${city} ${name}`, abbreviation });
const nbaGame = (id, datetime, status_state, home_team, visitor_team, home_team_score = 0, visitor_team_score = 0, extra = {}) => ({
  id,
  date: datetime ? new Date(Date.parse(datetime) - 5 * 3600 * 1000).toISOString().slice(0, 10) : "2026-11-24",
  season: 2026,
  status: status_state === "final" ? "Final" : status_state === "scheduled" ? "7:30 pm ET" : "3rd Qtr",
  status_state,
  period: status_state === "final" ? 4 : 0,
  time: status_state === "final" ? "Final" : "",
  postseason: false,
  postponed: false,
  home_team_score,
  visitor_team_score,
  datetime,
  home_ot1: null,
  visitor_ot1: null,
  home_team,
  visitor_team,
  ...extra,
});
const NYK = nbaTeam(20, "New York", "Knicks", "NYK");
const MIL = nbaTeam(17, "Milwaukee", "Bucks", "MIL");
const LAL = nbaTeam(14, "Los Angeles", "Lakers", "LAL");
const BOS = nbaTeam(2, "Boston", "Celtics", "BOS");
const GSW = nbaTeam(10, "Golden State", "Warriors", "GSW");
const DEN = nbaTeam(8, "Denver", "Nuggets", "DEN");

/** From the documentation: the example game on the "Get All Games" page. */
export const nbaFromTheDocs = {
  id: 15907925, date: "2025-01-05", season: 2024, status: "Final", status_state: "final", period: 4, time: "Final", postseason: false, postponed: false,
  home_team_score: 115, visitor_team_score: 105, datetime: "2025-01-05T23:00:00.000Z",
  home_q1: 29, home_q2: 34, home_q3: 28, home_q4: 24, home_ot1: null, home_ot2: null, home_ot3: null,
  visitor_q1: 23, visitor_q2: 25, visitor_q3: 30, visitor_q4: 27, visitor_ot1: null, visitor_ot2: null, visitor_ot3: null, ist_stage: null,
  home_team: { id: 6, conference: "East", division: "Central", city: "Cleveland", name: "Cavaliers", full_name: "Cleveland Cavaliers", abbreviation: "CLE" },
  visitor_team: { id: 4, conference: "East", division: "Southeast", city: "Charlotte", name: "Hornets", full_name: "Charlotte Hornets", abbreviation: "CHA" },
};

/** The NBA's answer comes in pages. These are two. */
export const nbaPages = [
  {
    data: [
      nbaGame(18000001, "2026-11-22T00:30:00.000Z", "final", LAL, BOS, 104, 97),
      // Overtime: level at 110 after four quarters, then 121 – 118.
      nbaGame(18000002, "2026-11-22T03:00:00.000Z", "final", DEN, GSW, 121, 118, { period: 5, home_ot1: 11, visitor_ot1: 8 }),
      nbaGame(18000003, "2026-11-25T00:30:00.000Z", "scheduled", NYK, MIL),
      nbaGame(18000004, "2026-11-25T03:00:00.000Z", "scheduled", GSW, DEN),
    ],
    meta: { next_cursor: 18000004, per_page: 100 },
  },
  {
    data: [
      nbaGame(18000005, "2026-11-24T00:00:00.000Z", "in_progress", BOS, NYK, 61, 58),
      nbaGame(18000006, "2026-11-23T00:00:00.000Z", "postponed", MIL, LAL, 0, 0, { postponed: true }),
      nbaGame(18000007, "2026-11-23T01:00:00.000Z", "canceled", DEN, BOS),
      nbaGame(18000008, "2026-11-23T02:00:00.000Z", "suspended", LAL, GSW, 40, 44),
      nbaGame(18000009, "2026-11-23T03:00:00.000Z", "final", NYK, GSW, 99, 99),
      nbaGame(18000010, "2026-11-23T04:00:00.000Z", "unknown", MIL, DEN),
      // Only a day, no start time.
      nbaGame(18000011, null, "scheduled", BOS, MIL),
      // Outside the days asked for: the request starts a day early on purpose.
      nbaGame(18000012, "2026-11-20T23:00:00.000Z", "final", MIL, BOS, 90, 120),
    ],
    meta: { per_page: 100 },
  },
];

/** From the documentation: the example game on the WNBA "Get All Games" page. */
export const wnbaFromTheDocs = {
  data: [
    {
      id: 4167, date: "2025-10-05T19:00:00.000Z", season: 2025, postseason: true, status: "post", status_state: "final", period: 4, time: "0.0",
      home_team: { id: 8, conference: "Western Conference", city: "Las Vegas", name: "Aces", full_name: "Las Vegas Aces", abbreviation: "LV" },
      visitor_team: { id: 10, conference: "Western Conference", city: "Phoenix", name: "Mercury", full_name: "Phoenix Mercury", abbreviation: "PHX" },
      home_score: 91, away_score: 78,
    },
  ],
  meta: { per_page: 25 },
};

/** A stand-in for the web: it answers each address with a saved example and remembers what was asked. */
export function fakeWeb(answers) {
  const asked = [];
  const fetch = async (url, init = {}) => {
    asked.push({ url, headers: init.headers ?? {} });
    for (const [pattern, answer] of answers) {
      if (!url.includes(pattern)) continue;
      const body = typeof answer === "function" ? answer(url) : answer;
      if (typeof body === "number") return { ok: false, status: body, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => structuredClone(body) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetch, asked };
}
