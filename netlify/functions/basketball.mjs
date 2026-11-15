const LEAGUE = "womens-college-basketball";

const BASE =
  `https://site.api.espn.com/apis/site/v2/sports/basketball/${LEAGUE}`;

const HISTORY_COUNT = 5;

function respond(data, status = 200) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify(data)
  };
}

async function getJSON(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "NCAA-Basketball-Prediction-Lab/2.0"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(
      `ESPN HTTP ${response.status}: ${url}`
    );
  }

  return response.json();
}

function numericScore(competitor) {
  const score = competitor?.score;

  if (score === null || score === undefined) {
    return null;
  }

  let value = score;

  if (typeof score === "object") {
    value =
      score.value ??
      score.displayValue ??
      score.score ??
      null;
  }

  if (value === null || value === undefined || value === "") {
    return null;
  }

  const result = Number(value);

  return Number.isFinite(result) ? result : null;
}

function isCompleted(event) {
  const status =
    event?.status?.type ??
    event?.competitions?.[0]?.status?.type ??
    {};

  return (
    status.completed === true ||
    status.name === "STATUS_FINAL" ||
    status.state === "post"
  );
}

function parseGame(event, teamId = null) {
  const competition = event?.competitions?.[0];

  if (!competition) {
    return null;
  }

  const competitors = competition.competitors || [];

  const home = competitors.find(
    c => c.homeAway === "home"
  );

  const away = competitors.find(
    c => c.homeAway === "away"
  );

  if (!home || !away) {
    return null;
  }

  const homeScore = numericScore(home);
  const awayScore = numericScore(away);

  const completed = isCompleted(event);

  const rank = competitor => {
    const value = Number(
      competitor?.curatedRank?.current
    );

    return (
      Number.isFinite(value) &&
      value >= 1 &&
      value <= 25
    )
      ? value
      : null;
  };

  const game = {
    id: String(event.id),
    date: event.date,
    status:
      event?.status?.type?.name ??
      competition?.status?.type?.name ??
      "",
    completed,
    neutral: Boolean(competition.neutralSite),

    home: {
      id: String(home.team?.id ?? ""),
      name:
        home.team?.displayName ??
        home.team?.name ??
        "Home",
      rank: rank(home),
      score: homeScore
    },

    away: {
      id: String(away.team?.id ?? ""),
      name:
        away.team?.displayName ??
        away.team?.name ??
        "Away",
      rank: rank(away),
      score: awayScore
    }
  };

  if (teamId === null) {
    return game;
  }

  const id = String(teamId);

  const side =
    game.home.id === id
      ? "home"
      : game.away.id === id
        ? "away"
        : null;

  if (
    !side ||
    !completed ||
    homeScore === null ||
    awayScore === null
  ) {
    return null;
  }

  const opponentSide =
    side === "home" ? "away" : "home";

  return {
    id: game.id,
    date: game.date,
    pf: game[side].score,
    pa: game[opponentSide].score,
    opponent: game[opponentSide].name,
    opponentId: game[opponentSide].id,
    home: side === "home",
    neutral: game.neutral
  };
}

function getSeason(date) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));

  return month >= 8 ? year + 1 : year;
}

function getCutoff(date) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));

  // Exclude the entire selected game date.
  // Prevents using the result of the game being predicted.
  return Date.UTC(year, month - 1, day);
}

function formatDate(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("");
}

function extractHistory(events, teamId, cutoff, count) {
  const seen = new Set();

  return events
    .filter(event => {
      const timestamp = Date.parse(event.date);

      return (
        Number.isFinite(timestamp) &&
        timestamp < cutoff
      );
    })
    .sort(
      (a, b) =>
        Date.parse(b.date) - Date.parse(a.date)
    )
    .map(event => parseGame(event, teamId))
    .filter(game => {
      if (!game || seen.has(game.id)) {
        return false;
      }

      seen.add(game.id);
      return true;
    })
    .slice(0, count);
}

async function getTeamSchedule(teamId, season) {
  const urls = [
    `${BASE}/teams/${teamId}/schedule?season=${season}&seasontype=2&limit=250`,
    `${BASE}/teams/${teamId}/schedule?season=${season}&limit=250`
  ];

  const results = [];
  const errors = [];

  for (const url of urls) {
    try {
      const data = await getJSON(url);

      const events = Array.isArray(data.events)
        ? data.events
        : [];

      results.push(...events);

      if (events.length > 0) {
        break;
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  return {
    events: results,
    errors
  };
}

async function scoreboardFallback(
  teamId,
  cutoff,
  count,
  existingGames
) {
  const collected = [...existingGames];
  const seen = new Set(collected.map(g => g.id));

  // Search backward in 14-day windows.
  // This is a fallback when the team schedule endpoint
  // does not provide enough completed games.

  for (let windowIndex = 0; windowIndex < 12; windowIndex++) {
    if (collected.length >= count) {
      break;
    }

    const end = new Date(
      cutoff - 1 - windowIndex * 14 * 86400000
    );

    const start = new Date(
      end.getTime() - 13 * 86400000
    );

    const dateRange =
      `${formatDate(start)}-${formatDate(end)}`;

    try {
      const data = await getJSON(
        `${BASE}/scoreboard?dates=${dateRange}&groups=50&limit=1000`
      );

      const games = extractHistory(
        data.events || [],
        teamId,
        cutoff,
        count
      );

      for (const game of games) {
        if (!seen.has(game.id)) {
          seen.add(game.id);
          collected.push(game);
        }
      }
    } catch (error) {
      // Continue checking earlier date windows.
    }
  }

  return collected
    .sort(
      (a, b) =>
        Date.parse(b.date) - Date.parse(a.date)
    )
    .slice(0, count);
}

async function getHistory(teamId, date, count) {
  const season = getSeason(date);
  const cutoff = getCutoff(date);

  const allEvents = [];
  const errors = [];

  // Start with the selected season.
  // Use the previous season only if necessary.
  for (const year of [season, season - 1]) {
    const result = await getTeamSchedule(
      teamId,
      year
    );

    allEvents.push(...result.events);
    errors.push(...result.errors);

    const available = extractHistory(
      allEvents,
      teamId,
      cutoff,
      count
    );

    if (available.length >= count) {
      return {
        teamId,
        games: available,
        coverage: available.length,
        requested: count,
        source: "team-schedule"
      };
    }
  }

  let games = extractHistory(
    allEvents,
    teamId,
    cutoff,
    count
  );

  // Try scoreboard history when team schedules
  // contain insufficient completed results.
  if (games.length < count) {
    games = await scoreboardFallback(
      teamId,
      cutoff,
      count,
      games
    );
  }

  return {
    teamId,
    games,
    coverage: games.length,
    requested: count,
    source:
      games.length > 0
        ? "schedule-and-scoreboard"
        : "no-valid-history",
    diagnostics:
      games.length === 0
        ? errors.slice(0, 3)
        : undefined
  };
}

export const handler = async event => {
  try {
    const q = event.queryStringParameters || {};

    const date =
      /^\d{8}$/.test(q.date || "")
        ? q.date
        : new Date()
            .toISOString()
            .slice(0, 10)
            .replace(/-/g, "");

    if (q.action === "schedule") {
      const data = await getJSON(
        `${BASE}/scoreboard?dates=${date}&groups=50&limit=400`
      );

      return respond({
        date,
        events: (data.events || [])
          .map(game => parseGame(game))
          .filter(Boolean)
      });
    }

    if (q.action === "team") {
      if (!/^\d+$/.test(q.id || "")) {
        return respond(
          { error: "Invalid team ID" },
          400
        );
      }

      const count = Math.min(
        5,
        Math.max(
          1,
          Number(q.count) || HISTORY_COUNT
        )
      );

      const result = await getHistory(
        q.id,
        date,
        count
      );

      return respond(result);
    }

    return respond(
      { error: "Unknown action" },
      400
    );

  } catch (error) {
    return respond(
      {
        error: String(
          error.message || error
        )
      },
      502
    );
  }
};
