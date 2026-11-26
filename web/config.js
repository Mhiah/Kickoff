// Where Kickoff's server is. Empty means "the same site this page came from", which is how the
// site is hosted. A copy of the site kept somewhere else puts the server's full address here.
export const SERVER = "";

// The public key of Kickoff's robot. When a player predicts, their phone locks a copy of the
// prediction to this key, so the robot can open it after kickoff and the player never has to come
// back. It is a public key: safe to show to anyone. The robot prints it at the top of every run,
// and it must be that robot's and nobody else's. If it were null, predictions would be sent without a
// copy and could only be opened by the phone that made them.
export const ROBOT_KEY = "041c33b97024442f75b85016b7f6eed75964433da6f325076b9a7399609df2024fd350e04b8d9d74bec7fc50947c6052eba9a5beeb3472e4be19a2d4fa82685374";

// The public key of Kickoff's server. Each time the server takes a sealed prediction it signs a
// short note saying so, and the phone checks that note against this key and keeps it. If the
// prediction is later missing from what was locked on X Layer, the note is the player's proof that
// Kickoff was given it in time. It is a public key: safe to show to anyone. The "Server's public
// key" action prints it. If it were null, notes would not be asked for or checked.
export const SERVER_KEY = null;

// Where Kickoff is on X Layer. These are public: anyone can look them up.
//   processor  the TapeOut processor Kickoff's circuits are published on
//   circuits   the number of each of Kickoff's circuits on that processor. The league's own
//              circuit holds the account every lock and result is sent from.
//   explorer   a site that shows X Layer's records to a person
export const ON_CHAIN = Object.freeze({
  processor: "0x39e44dba62811e87fde122ca4d6c082568a384d0",
  circuits: Object.freeze({ league: 5, football: 6, basketball: 7, tennis: 8, result: 9, goalgoal: 10, score: 11 }),
  explorer: "https://www.oklink.com/xlayer",
});
