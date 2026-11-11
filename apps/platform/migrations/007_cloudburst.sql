-- Game #2. Its score is the points a player ended the match on (fewest wins).
INSERT INTO games (slug, name, min_players, max_players, score_label) VALUES ('cloudburst', 'Cloudburst', 2, 6, 'Points');

-- Roll back (only while no match references it):
--   DELETE FROM games WHERE slug = 'cloudburst';
