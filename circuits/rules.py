"""The scoring rules of Kickoff written as ordinary code, straight from docs/RULES.md.

This file knows nothing about circuits, gates or bits. It takes the things a person would say
("I picked 2-1, it ended 3-1") and returns the points. check.py uses it as the answer sheet that
the circuits are marked against.
"""
from __future__ import annotations


def football_points(my_home: int, my_away: int, real_home: int, real_away: int) -> int:
    """3 for the exact score, 1 for the right result with the wrong score, otherwise 0."""
    if my_home == real_home and my_away == real_away:
        return 3

    def result(home: int, away: int) -> str:
        if home > away:
            return "home win"
        if home < away:
            return "away win"
        return "draw"

    return 1 if result(my_home, my_away) == result(real_home, real_away) else 0


def result_points(my_result: str, real_home: int, real_away: int) -> int:
    """Football, the Result prediction: 1 for saying how the match ends, otherwise 0.

    my_result is "home", "draw" or "away". Anything else is not a prediction and scores 0."""
    if real_home > real_away:
        real = "home"
    elif real_home < real_away:
        real = "away"
    else:
        real = "draw"
    return 1 if my_result == real else 0


def goal_goal_points(my_both_score: bool, real_home: int, real_away: int) -> int:
    """Football, the Goal Goal prediction: 1 for saying whether both sides score, otherwise 0."""
    return 1 if my_both_score == (real_home > 0 and real_away > 0) else 0


def score_points(my_home: int, my_away: int, real_home: int, real_away: int) -> int:
    """Football, the Exact score prediction: 3 for the exact score, otherwise 0."""
    return 3 if my_home == real_home and my_away == real_away else 0


def basketball_points(my_winner: str, my_band: str, real_winner: str, real_band: str) -> int:
    """3 for the right winner and the right margin band, 1 for the right winner only, else 0.

    Winners are "home" or "away". Bands are "A" (1-5), "B" (6-10), "C" (11-15), "D" (16+)."""
    if my_winner != real_winner:
        return 0
    return 3 if my_band == real_band else 1


def tennis_points(my_winner: str, my_sets: int, real_winner: str, real_sets: int, best_of: int) -> int:
    """3 for the right winner and the right number of sets, 1 for the right winner only, else 0.

    Winners are "A" or "B". best_of is 3 or 5. A number of sets that cannot happen in that kind of
    match (2 sets in a best of 5, or 4 sets in a best of 3) scores 0."""
    allowed = {3: (2, 3), 5: (3, 4, 5)}[best_of]
    if my_sets not in allowed or real_sets not in allowed:
        return 0
    if my_winner != real_winner:
        return 0
    return 3 if my_sets == real_sets else 1
