// Where Kickoff's server is. Empty means "the same site this page came from", which is how the
// site is hosted. A copy of the site kept somewhere else puts the server's full address here.
export const SERVER = "";

// The public key of Kickoff's robot. When a player predicts, their phone locks a copy of the
// prediction to this key, so the robot can open it after kickoff and the player never has to come
// back. It is a public key: safe to show to anyone. The robot prints it at the top of every run,
// and it must be that robot's and nobody else's. While it is null, predictions are sent without a
// copy and can only be opened by the phone that made them.
export const ROBOT_KEY = null;

// Where Kickoff is on X Layer. These are public: anyone can look them up.
//   processor  the TapeOut processor Kickoff's circuits are published on
//   circuits   the number of each of Kickoff's circuits on that processor. The league's own
//              circuit holds the account every lock and result is sent from.
//   explorer   a site that shows X Layer's records to a person
export const ON_CHAIN = Object.freeze({
  processor: "0x39e44dba62811e87fde122ca4d6c082568a384d0",
  circuits: Object.freeze({ league: 5, football: 6, basketball: 7, tennis: 8 }),
  explorer: "https://www.oklink.com/xlayer",
});
