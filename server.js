const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { URL } = require("node:url");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const SNAPSHOT_FILE = path.join(DATA_DIR, "last-successful-dashboard.json");
const SEED_SNAPSHOT_FILE = path.join(DATA_DIR, "seed-dashboard.json");
const DEFAULT_CHAIN = "solana";
const PORT = Number(process.env.PORT || 3000);
const API_BASE_URL = "https://public-api.birdeye.so";
const cache = new Map();

loadEnv(path.join(ROOT, ".env"));
loadEnv(path.join(ROOT, ".env.local"));

const CONFIG = {
  port: Number(process.env.PORT || PORT),
  chain: process.env.BIRDEYE_CHAIN || DEFAULT_CHAIN,
  apiKey: process.env.BIRDEYE_API_KEY || ""
};

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (requestUrl.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        hasApiKey: Boolean(CONFIG.apiKey),
        chain: CONFIG.chain,
        now: new Date().toISOString()
      });
    }

    if (requestUrl.pathname === "/api/dashboard") {
      const chain = sanitizeChain(requestUrl.searchParams.get("chain") || CONFIG.chain);
      const limit = clampInteger(requestUrl.searchParams.get("limit"), 6, 16, 12);
      const includeMeme = parseBoolean(requestUrl.searchParams.get("includeMeme"), true);
      let dashboard;
      try {
        dashboard = await buildDashboard({ chain, limit, includeMeme });
      } catch (error) {
        const snapshot = loadFallbackSnapshot();
        if (snapshot && isBirdeyeCapacityError(error)) {
          dashboard = buildSnapshotFallbackResponse(snapshot, error);
        } else {
          throw error;
        }
      }
      return sendJson(res, 200, dashboard);
    }

    return serveStatic(res, requestUrl.pathname);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return sendJson(res, statusCode, {
      ok: false,
      error: error.message || "Unexpected server error"
    });
  }
});

server.listen(CONFIG.port, () => {
  console.log(`LaunchLens running on http://localhost:${CONFIG.port}`);
});

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function serveStatic(res, pathname) {
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const relativePath = normalized.replace(/^[/\\]+/, "") || "index.html";
  const safePath = path.normalize(relativePath);
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (safePath.startsWith("..") || !filePath.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { ok: false, error: "Forbidden" });
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return sendJson(res, 404, { ok: false, error: "Not found" });
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || "application/octet-stream";
  const content = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": mime,
    "Cache-Control": "no-store",
    "Content-Length": content.length
  });
  res.end(content);
}

async function buildDashboard({ chain, limit, includeMeme }) {
  if (!CONFIG.apiKey) {
    const error = new Error("Missing BIRDEYE_API_KEY. Add it to .env.local before calling the dashboard.");
    error.statusCode = 500;
    throw error;
  }

  const cacheKey = `dashboard:${chain}:${limit}:${includeMeme}`;
  return withCache(cacheKey, 45_000, async () => {
    const warnings = [];
    const [listingsResult, trendingResult] = await Promise.allSettled([
      getNewListings({ chain, limit: 20, includeMeme }),
      getTrending({ chain, limit: 20, interval: "1h" })
    ]);

    if (listingsResult.status !== "fulfilled") {
      throw listingsResult.reason;
    }

    if (trendingResult.status !== "fulfilled") {
      warnings.push("Trending feed temporarily unavailable, running in listings-only mode.");
    }

    const listingItems = extractArray(listingsResult.value);
    const trendingItems = trendingResult.status === "fulfilled" ? extractArray(trendingResult.value) : [];
    const candidateMap = new Map();

    for (const item of listingItems) {
      registerCandidate(candidateMap, item, "new");
    }

    for (const item of trendingItems) {
      registerCandidate(candidateMap, item, "trending");
    }

    const candidates = Array.from(candidateMap.values());
    const seedCandidates = candidates
      .sort((left, right) => seedCandidateRank(right) - seedCandidateRank(left))
      .slice(0, Math.max(limit + 4, 10));

    const overviewEntries = await runPool(
      seedCandidates,
      1,
      async (candidate) => [
        candidate.address,
        await safeRequest(() => getOverviewSnapshot(candidate.address, chain), null)
      ]
    );

    const overviewMap = new Map(
      overviewEntries.filter((entry) => entry[1] && typeof entry[1] === "object")
    );

    if (overviewMap.size < seedCandidates.length) {
      warnings.push("Some overview enrichments were unavailable on the current API plan or rate window.");
    }

    const enriched = seedCandidates
      .map((candidate) => enrichToken(candidate, overviewMap.get(candidate.address)))
      .filter((token) => token.address && token.symbol);

    const topCandidates = enriched
      .sort((a, b) => b.preliminaryRank - a.preliminaryRank)
      .slice(0, limit);

    const scoredTokens = topCandidates
      .map((token) => finalizeToken(token))
      .sort((a, b) => b.flightScore - a.flightScore);

    const response = {
      ok: true,
      product: {
        name: "LaunchLens",
        tagline: "A real-time Solana launch radar that filters noise into actionable watchlists."
      },
      chain,
      generatedAt: new Date().toISOString(),
      apiCallEstimate: estimateApiCalls(scoredTokens.length),
      endpointsUsed: [
        "/defi/v2/tokens/new_listing",
        "/defi/token_trending",
        "/defi/token_overview"
      ],
      pulse: buildPulseSummary(scoredTokens),
      methodology: {
        weights: {
          safety: 0.4,
          momentum: 0.35,
          structure: 0.25
        },
        note: "Scores favor tokens that combine healthy execution quality, liquidity support, fresh participation, and breakout momentum."
      },
      warnings,
      tokens: scoredTokens
    };
    persistDashboardSnapshot(response);
    return response;
  });
}

function sanitizeChain(chain) {
  const normalized = String(chain || DEFAULT_CHAIN).toLowerCase();
  return normalized || DEFAULT_CHAIN;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(number)));
}

function parseBoolean(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const normalized = String(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

async function birdeyeGet(endpoint, params, chain, ttlMs) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }

  const query = search.toString();
  const url = `${API_BASE_URL}${endpoint}${query ? `?${query}` : ""}`;
  const cacheKey = `bird:${chain}:${endpoint}:${query}`;

  return withCache(cacheKey, ttlMs, async () => {
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-chain": chain,
          "X-API-KEY": CONFIG.apiKey
        }
      });

      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (error) {
        const parseError = new Error(`Invalid JSON from Birdeye for ${endpoint}`);
        parseError.statusCode = 502;
        throw parseError;
      }

      if (response.status === 429 || payload.message === "Too many requests") {
        lastError = new Error(`Birdeye request failed for ${endpoint}: Too many requests`);
        lastError.statusCode = 429;
        await sleep(900 * (attempt + 1));
        continue;
      }

      if (!response.ok || payload.success === false) {
        const message = payload.message || payload.error || `${response.status} ${response.statusText}`;
        const requestError = new Error(`Birdeye request failed for ${endpoint}: ${message}`);
        requestError.statusCode = response.status || 502;
        throw requestError;
      }

      return payload;
    }

    throw lastError || new Error(`Birdeye request failed for ${endpoint}`);
  });
}

function withCache(key, ttlMs, factory) {
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) {
    return existing.value instanceof Promise ? existing.value : Promise.resolve(existing.value);
  }

  const promise = Promise.resolve()
    .then(factory)
    .then((value) => {
      cache.set(key, {
        expiresAt: Date.now() + ttlMs,
        value
      });
      return value;
    })
    .catch((error) => {
      cache.delete(key);
      throw error;
    });

  cache.set(key, {
    expiresAt: now + ttlMs,
    value: promise
  });
  return promise;
}

function extractArray(payload) {
  const data = payload && typeof payload === "object" && "data" in payload ? payload.data : payload;

  if (Array.isArray(data)) {
    return data;
  }

  if (!data || typeof data !== "object") {
    return [];
  }

  for (const key of ["items", "tokens", "list", "results", "data"]) {
    if (Array.isArray(data[key])) {
      return data[key];
    }
  }

  return [];
}

function registerCandidate(candidateMap, rawItem, source) {
  const address = pickFirstString(rawItem, [
    "address",
    "tokenAddress",
    "token_address",
    "mint",
    "baseAddress",
    "base_address"
  ]);

  if (!address) {
    return;
  }

  const existing = candidateMap.get(address) || {
    address,
    symbol: pickFirstString(rawItem, ["symbol", "tokenSymbol"]) || "UNKNOWN",
    name: pickFirstString(rawItem, ["name", "tokenName"]) || "Unnamed token",
    sources: new Set(),
    raw: []
  };

  existing.sources.add(source);
  existing.raw.push(rawItem);

  if (!existing.listedAt) {
    existing.listedAt = pickFirstTimestamp(rawItem, [
      "listingTime",
      "listedAt",
      "createdAt",
      "createdTime",
      "liquidityAddedAt",
      "time",
      "timestamp"
    ]);
  }

  existing.symbol = existing.symbol || pickFirstString(rawItem, ["symbol", "tokenSymbol"]) || "UNKNOWN";
  existing.name = existing.name || pickFirstString(rawItem, ["name", "tokenName"]) || "Unnamed token";

  candidateMap.set(address, existing);
}

async function getNewListings({ chain, limit, includeMeme }) {
  return birdeyeGet(
    "/defi/v2/tokens/new_listing",
    {
      time_to: Math.floor(Date.now() / 1000),
      limit,
      meme_platform_enabled: includeMeme
    },
    chain,
    30_000
  );
}

async function getTrending({ chain, limit, interval }) {
  return birdeyeGet(
    "/defi/token_trending",
    {
      sort_by: "rank",
      sort_type: "asc",
      interval,
      offset: 0,
      limit,
      ui_amount_mode: "scaled"
    },
    chain,
    30_000
  );
}

async function getOverviewSnapshot(address, chain) {
  const payload = await birdeyeGet(
    "/defi/token_overview",
    {
      address,
      frames: "1h,24h",
      ui_amount_mode: "scaled"
    },
    chain,
    75_000
  );
  return payload.data || null;
}

function enrichToken(candidate, overview = {}) {
  const sourceCount = candidate.sources.size;
  const listedAt =
    candidate.listedAt ||
    pickFirstTimestamp(overview, ["lastTradeUnixTime", "lastTradeHumanTime", "createdAt", "listingTime"]);
  const ageMinutes = listedAt ? Math.max(1, Math.floor((Date.now() / 1000 - listedAt) / 60)) : null;

  const price = pickFirstNumber(overview, ["price"]);
  const liquidity = pickFirstNumber(overview, ["liquidity"]);
  const volume24h = pickFirstNumber(overview, ["v24hUSD", "v24h"]);
  const marketCap = pickFirstNumber(overview, ["marketCap", "mc"]);
  const fdv = pickFirstNumber(overview, ["fdv"]);
  const priceChange1h = pickFirstNumber(overview, ["priceChange1hPercent"]);
  const priceChange24h = pickFirstNumber(overview, ["priceChange24hPercent"]);
  const volumeChange1h = pickFirstNumber(overview, ["v1hChangePercent"]);
  const trades24h = pickFirstNumber(overview, ["trade24h"]);
  const trades1h = pickFirstNumber(overview, ["trade1h"]);
  const holderCount = pickFirstNumber(overview, ["holder"]);
  const uniqueWallet1h = pickFirstNumber(overview, ["uniqueWallet1h"]);
  const uniqueWallet24h = pickFirstNumber(overview, ["uniqueWallet24h"]);
  const uniqueWallet1hChangePercent = pickFirstNumber(overview, ["uniqueWallet1hChangePercent"]);
  const numberMarkets = pickFirstNumber(overview, ["numberMarkets"]);

  const freshnessBoost = ageMinutes ? clamp(scaleValue(240 - ageMinutes, 0, 240), 0, 1) : 0.2;
  const liquidityBoost = scaleValue(liquidity || 0, 10_000, 400_000);
  const volumeBoost = scaleValue(volume24h || 0, 50_000, 5_000_000);
  const momentumBoost = scaleValue(priceChange1h || 0, -5, 40);
  const overlapBoost = sourceCount > 1 ? 0.18 : 0;

  return {
    address: candidate.address,
    symbol: pickFirstString(overview, ["symbol"]) || candidate.symbol,
    name: pickFirstString(overview, ["name"]) || candidate.name,
    logo: pickFirstString(overview, ["logoURI", "logo_uri", "logo"]) || pickFirstString(candidate.raw[0], ["logoURI"]) || "",
    website: pickFirstString(overview, ["extensions.website", "website", "websiteUrl"]) || "",
    twitter: pickFirstString(overview, ["extensions.twitter", "twitter", "x", "twitter_url"]) || "",
    listedAt: listedAt || null,
    ageMinutes,
    sources: Array.from(candidate.sources),
    rawSourceCount: sourceCount,
    price: price || 0,
    liquidity: liquidity || 0,
    volume24h: volume24h || 0,
    marketCap: marketCap || 0,
    fdv: fdv || 0,
    priceChange1h: priceChange1h || 0,
    priceChange24h: priceChange24h || 0,
    volumeChange1h: volumeChange1h || 0,
    trades1h: trades1h || 0,
    trades24h: trades24h || 0,
    holderCount: holderCount || 0,
    uniqueWallet1h: uniqueWallet1h || 0,
    uniqueWallet24h: uniqueWallet24h || 0,
    uniqueWallet1hChangePercent: uniqueWallet1hChangePercent || 0,
    numberMarkets: numberMarkets || 0,
    preliminaryRank:
      freshnessBoost * 0.25 +
      liquidityBoost * 0.2 +
      volumeBoost * 0.22 +
      momentumBoost * 0.15 +
      overlapBoost +
      scaleValue(trades24h || 0, 50, 2500) * 0.18
  };
}

function finalizeToken(token) {
  const holderMetrics = analyzeParticipationProfile(token);
  const securityScore = computeSafetyScore(token, holderMetrics);
  const momentumScore = computeMomentumScore(token);
  const structureScore = computeStructureScore(token, holderMetrics);
  const flightScore = Math.round(
    clamp(
      securityScore * 0.4 + momentumScore * 0.35 + structureScore * 0.25,
      0,
      100
    )
  );

  const verdict = classifyVerdict(flightScore, securityScore, momentumScore);
  const redFlags = detectRedFlags(token, holderMetrics);
  const catalysts = buildCatalysts(token, securityScore, momentumScore, structureScore);

  return {
    ...token,
    securityScore,
    momentumScore,
    structureScore,
    flightScore,
    verdict,
    holderMetrics,
    securitySummary: summarizeQuality(token, holderMetrics),
    redFlags,
    catalysts,
    narrative: buildNarrative(token, verdict, holderMetrics, redFlags)
  };
}

function analyzeParticipationProfile(token) {
  return {
    holderCount: token.holderCount || 0,
    uniqueWallet1h: token.uniqueWallet1h || 0,
    uniqueWallet24h: token.uniqueWallet24h || 0,
    walletChange1h: token.uniqueWallet1hChangePercent || 0,
    numberMarkets: token.numberMarkets || 0
  };
}

function computeSafetyScore(token, holderMetrics) {
  let score = 18;

  score += scaleValue(token.liquidity, 10_000, 500_000) * 34;
  score += scaleValue(holderMetrics.holderCount, 120, 4_500) * 20;
  score += scaleValue(holderMetrics.uniqueWallet1h, 25, 2_000) * 12;
  score += scaleValue(holderMetrics.numberMarkets, 1, 40) * 10;
  score += scaleValue(token.price, 0.0000001, 1) * 2;

  if (holderMetrics.walletChange1h >= 0) {
    score += 6;
  }
  if (token.rawSourceCount > 1) {
    score += 6;
  }
  if (token.priceChange1h > 120 && token.liquidity < 50_000) {
    score -= 10;
  }
  if (token.liquidity < 8_000) {
    score -= 18;
  }

  return Math.round(clamp(score, 5, 98));
}

function computeMomentumScore(token) {
  const priceImpulse = scaleValue(token.priceChange1h, -8, 55);
  const dayTrend = scaleValue(token.priceChange24h, -20, 180);
  const volumeImpulse = scaleValue(token.volumeChange1h, -30, 300);
  const liquiditySupport = scaleValue(token.liquidity, 10_000, 500_000);
  const participation = scaleValue(token.trades24h, 30, 3000);
  const sourceOverlap = token.rawSourceCount > 1 ? 0.12 : 0;

  const score = (
    priceImpulse * 0.28 +
    dayTrend * 0.2 +
    volumeImpulse * 0.22 +
    liquiditySupport * 0.14 +
    participation * 0.16 +
    sourceOverlap
  ) * 100;

  return Math.round(clamp(score, 0, 100));
}

function computeStructureScore(token, holderMetrics) {
  const freshness = token.ageMinutes ? scaleValue(360 - token.ageMinutes, 0, 360) : 0.3;
  const liquidity = scaleValue(token.liquidity, 20_000, 500_000);
  const capQuality = token.marketCap ? scaleValue(token.marketCap, 100_000, 25_000_000) : 0.35;
  const walletQuality = scaleValue(holderMetrics.uniqueWallet1h, 25, 2_000);
  const marketBreadth = scaleValue(holderMetrics.numberMarkets, 1, 30);
  const volumeSupport = scaleValue(token.volume24h, 50_000, 6_000_000);

  const score = (
    freshness * 0.23 +
    liquidity * 0.24 +
    capQuality * 0.14 +
    walletQuality * 0.21 +
    marketBreadth * 0.08 +
    volumeSupport * 0.1
  ) * 100;
  return Math.round(clamp(score, 0, 100));
}

function classifyVerdict(flightScore, safetyScore, momentumScore) {
  if (flightScore >= 80 && safetyScore >= 70 && momentumScore >= 62) {
    return "Prime Setup";
  }
  if (flightScore >= 70 && momentumScore >= 60) {
    return "Momentum Watch";
  }
  if (safetyScore >= 68 && flightScore >= 60) {
    return "Clean Watchlist";
  }
  if (momentumScore >= 68) {
    return "High Beta";
  }
  return "Speculative";
}

function summarizeQuality(token, holderMetrics) {
  return {
    deepLiquidity: token.liquidity >= 100_000,
    broadHolderBase: holderMetrics.holderCount >= 250,
    walletGrowth: holderMetrics.walletChange1h >= 0,
    multiMarket: holderMetrics.numberMarkets >= 5
  };
}

function detectRedFlags(token, holderMetrics) {
  const flags = [];

  if (token.liquidity < 25_000) {
    flags.push("Liquidity is still thin for confident execution.");
  }
  if (holderMetrics.holderCount < 120) {
    flags.push("Holder base is still shallow for a stable follow-through.");
  }
  if (holderMetrics.walletChange1h < -10) {
    flags.push("Unique wallet participation is shrinking on the last 1h window.");
  }
  if (token.priceChange1h > 140 && token.liquidity < 75_000) {
    flags.push("Price is accelerating too quickly relative to available liquidity.");
  }

  return flags;
}

function buildCatalysts(token, safetyScore, momentumScore, structureScore) {
  const items = [];

  if (token.sources.includes("new")) {
    items.push("Fresh listing surfaced by Birdeye new listings feed.");
  }
  if (token.sources.includes("trending")) {
    items.push("Already earning attention on Birdeye trending tokens.");
  }
  if (momentumScore >= 70) {
    items.push(`Momentum is expanding with ${formatPercent(token.priceChange1h)} in the last hour.`);
  }
  if (safetyScore >= 72) {
    items.push("Execution quality looks healthier than the average fresh listing.");
  }
  if (structureScore >= 70) {
    items.push("Liquidity and participation support follow-through potential.");
  }

  return items.slice(0, 4);
}

function buildNarrative(token, verdict, holderMetrics, redFlags) {
  const sourceNarrative =
    token.sources.length > 1
      ? "appeared in both the new listings stream and the trending feed"
      : token.sources.includes("new")
        ? "was surfaced as a fresh listing"
        : "is being pushed up the trending feed";

  const distributionText = holderMetrics.holderCount
    ? `${holderMetrics.holderCount.toLocaleString("en-US")} holders and ${holderMetrics.uniqueWallet1h.toLocaleString("en-US")} active wallets in the last hour support the setup.`
    : "Participation data is still limited.";

  const riskText = redFlags.length ? redFlags[0] : "No immediate structural red flag stands out.";

  return `${token.symbol} ${sourceNarrative}, currently scoring as ${verdict}. ${distributionText} ${riskText}`;
}

function buildPulseSummary(tokens) {
  const count = tokens.length || 1;
  const prime = tokens.filter((token) => token.verdict === "Prime Setup").length;
  const overlap = tokens.filter((token) => token.sources.length > 1).length;
  const avgSafety = average(tokens.map((token) => token.securityScore));
  const avgMomentum = average(tokens.map((token) => token.momentumScore));
  const medianFlight = median(tokens.map((token) => token.flightScore));

  return {
    tokenCount: tokens.length,
    primeSetups: prime,
    overlapSignals: overlap,
    avgSafety: roundTo(avgSafety, 1),
    avgMomentum: roundTo(avgMomentum, 1),
    medianFlightScore: roundTo(medianFlight, 1),
    leaderboardLeader: tokens[0]
      ? {
          symbol: tokens[0].symbol,
          flightScore: tokens[0].flightScore,
          verdict: tokens[0].verdict
        }
      : null
  };
}

function estimateApiCalls(tokenCount) {
  return {
    perRefresh: 2 + tokenCount,
    note: "A few manual refreshes plus normal exploration comfortably exceed the 50-call submission threshold."
  };
}

function isBirdeyeCapacityError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.statusCode === 429 ||
    message.includes("too many requests") ||
    message.includes("compute units usage limit exceeded") ||
    message.includes("rate limit")
  );
}

function loadFallbackSnapshot() {
  for (const filePath of [SNAPSHOT_FILE, SEED_SNAPSHOT_FILE]) {
    try {
      if (!fs.existsSync(filePath)) {
        continue;
      }
      const content = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(content);
      if (parsed && parsed.ok && Array.isArray(parsed.tokens) && parsed.tokens.length) {
        return parsed;
      }
    } catch (error) {
      continue;
    }
  }
  return null;
}

function persistDashboardSnapshot(snapshot) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), "utf8");
  } catch (error) {
    // Best-effort only.
  }
}

function buildSnapshotFallbackResponse(snapshot, error) {
  const clone = JSON.parse(JSON.stringify(snapshot));
  const warnings = Array.isArray(clone.warnings) ? clone.warnings.slice() : [];
  warnings.unshift("Live Birdeye capacity is temporarily constrained, so LaunchLens is showing the latest available snapshot.");
  if (error?.message) {
    warnings.push(error.message);
  }
  clone.ok = true;
  clone.warnings = warnings;
  return clone;
}

function seedCandidateRank(candidate) {
  const liquidityHint = pickFirstNumber(candidate.raw[0], ["liquidity"]) || 0;
  const sourceBoost = candidate.sources.size * 100_000_000;
  const freshnessHint = candidate.listedAt || 0;
  return sourceBoost + liquidityHint + freshnessHint;
}

async function runPool(items, concurrency, worker) {
  const results = [];
  let index = 0;

  async function consume() {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length || 1) }, consume);
  await Promise.all(workers);
  return results;
}

async function safeRequest(factory, fallback) {
  try {
    return await factory();
  } catch (error) {
    return fallback;
  }
}

function pickFirstString(input, keys) {
  for (const key of keys) {
    const value = resolveValue(input, key);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function pickFirstNumber(input, keys) {
  for (const key of keys) {
    const value = resolveValue(input, key);
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function pickFirstTimestamp(input, keys) {
  for (const key of keys) {
    const value = resolveValue(input, key);
    const normalized = normalizeTimestampValue(value);
    if (normalized !== null) {
      return normalized;
    }
  }
  return null;
}

function resolveValue(input, key) {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(input, key)) {
    return input[key];
  }

  const parts = key.split(".");
  let current = input;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function normalizeUnixSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  if (numeric > 10_000_000_000) {
    return Math.round(numeric / 1000);
  }

  return Math.round(numeric);
}

function normalizeTimestampValue(value) {
  if (typeof value === "string" && value.trim()) {
    const directNumber = Number(value);
    if (Number.isFinite(directNumber)) {
      return normalizeUnixSeconds(directNumber);
    }

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return Math.round(parsed / 1000);
    }
    return null;
  }

  return normalizeUnixSeconds(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scaleValue(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  if (max === min) {
    return 0;
  }

  return clamp((numeric - min) / (max - min), 0, 1);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (!filtered.length) {
    return 0;
  }
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function median(values) {
  const filtered = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!filtered.length) {
    return 0;
  }

  const middle = Math.floor(filtered.length / 2);
  if (filtered.length % 2 === 0) {
    return (filtered[middle - 1] + filtered[middle]) / 2;
  }
  return filtered[middle];
}

function roundTo(value, precision) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function formatPercent(value) {
  const numeric = Number(value) || 0;
  return `${numeric >= 0 ? "+" : ""}${roundTo(numeric, 1)}%`;
}

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};
