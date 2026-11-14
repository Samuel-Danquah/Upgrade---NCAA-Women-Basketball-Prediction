NCAA-Womens-Advanced-Pink-Predictor — advanced prediction model

Deploy to a NEW or existing Netlify Git-connected project. Upload index.html, netlify.toml and netlify/functions/basketball.mjs preserving paths.

Features: previous 4 game scores; editable points; scoring/defense blend; opponent recent-win-rate proxy; optional estimated possessions from ESPN box scores; pace/efficiency blending; home-court margin; totals and spreads; CSV.

Data limitations: recent opponent win rates from the historical ESPN scoreboard are NOT official strength-of-schedule ratings. Possessions use FGA - offensive rebounds + turnovers + 0.44*FTA, estimated from available box scores. Box score availability varies; click Load box-score possessions per matchup. Without adequate stats the model falls back to scoring/defense. Adjustments are heuristics, not validated predictive improvements. No sportsbook integration.

Verify the Netlify endpoint /api/basketball?mode=games&date=2026-11-14 after deployment.
