const state = {
  tokens: [],
  filteredTokens: [],
  selectedAddress: null,
  sortBy: "flightScore",
  verdict: "all",
  query: "",
  includeMeme: true,
  payload: null
};

const elements = {
  refreshButton: document.getElementById("refreshButton"),
  tokenGrid: document.getElementById("tokenGrid"),
  warningStrip: document.getElementById("warningStrip"),
  spotlightCard: document.getElementById("spotlightCard"),
  pulseStrip: document.getElementById("pulseStrip"),
  detailPanel: document.getElementById("detailPanel"),
  detailEmpty: document.getElementById("detailEmpty"),
  metricsGrid: document.getElementById("metricsGrid"),
  searchInput: document.getElementById("searchInput"),
  sortSelect: document.getElementById("sortSelect"),
  verdictSelect: document.getElementById("verdictSelect"),
  memeToggle: document.getElementById("memeToggle"),
  statusText: document.getElementById("statusText"),
  leaderToken: document.getElementById("leaderToken"),
  medianFlight: document.getElementById("medianFlight"),
  primeSetups: document.getElementById("primeSetups"),
  apiCallEstimate: document.getElementById("apiCallEstimate"),
  generatedAt: document.getElementById("generatedAt"),
  generatedAtHero: document.getElementById("generatedAtHero")
};

elements.refreshButton.addEventListener("click", () => loadDashboard(true));
elements.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value.trim().toLowerCase();
  syncView();
});
elements.sortSelect.addEventListener("change", (event) => {
  state.sortBy = event.target.value;
  syncView();
});
elements.verdictSelect.addEventListener("change", (event) => {
  state.verdict = event.target.value;
  syncView();
});
elements.memeToggle.addEventListener("click", () => {
  state.includeMeme = !state.includeMeme;
  elements.memeToggle.classList.toggle("is-active", state.includeMeme);
  elements.memeToggle.textContent = state.includeMeme ? "Enabled" : "Disabled";
  elements.memeToggle.setAttribute("aria-pressed", String(state.includeMeme));
  loadDashboard(true);
});

loadDashboard(false);

async function loadDashboard(isManualRefresh) {
  setStatus("loading", isManualRefresh ? "Refreshing" : "Loading");
  elements.refreshButton.disabled = true;

  try {
    const response = await fetch(`/api/dashboard?limit=12&includeMeme=${state.includeMeme}`);
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Dashboard request failed.");
    }

    state.payload = payload;
    state.tokens = payload.tokens || [];
    state.selectedAddress = state.tokens[0]?.address || null;
    hydrateSummary(payload);
    renderWarnings(payload.warnings || []);
    syncView();
    setStatus("ready", "Live");
  } catch (error) {
    renderError(error.message || "Could not load LaunchLens.");
    renderWarnings([]);
    setStatus("error", "Offline");
  } finally {
    elements.refreshButton.disabled = false;
  }
}

function hydrateSummary(payload) {
  const tokens = payload.tokens || [];
  const leader = tokens[0] || null;
  const strongestMomentum = [...tokens].sort(
    (left, right) => (right.priceChange1h || 0) - (left.priceChange1h || 0)
  )[0];
  const deepestLiquidity = [...tokens].sort(
    (left, right) => (right.liquidity || 0) - (left.liquidity || 0)
  )[0];
  const freshestListing = [...tokens]
    .filter((token) => Number.isFinite(token.ageMinutes))
    .sort((left, right) => (left.ageMinutes || 999999) - (right.ageMinutes || 999999))[0];

  elements.leaderToken.textContent = payload.pulse?.leaderboardLeader?.symbol || "-";
  elements.medianFlight.textContent = formatScore(payload.pulse?.medianFlightScore);
  elements.primeSetups.textContent = String(payload.pulse?.primeSetups || 0);
  elements.apiCallEstimate.textContent = String(payload.apiCallEstimate?.perRefresh || "-");

  const generatedText = payload.generatedAt
    ? `Updated ${new Date(payload.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "Syncing live radar...";

  elements.generatedAt.textContent = generatedText;
  elements.generatedAtHero.textContent = generatedText;

  const metrics = [
    {
      label: "Highest Momentum",
      value: strongestMomentum ? strongestMomentum.symbol : "-",
      detail: strongestMomentum
        ? `${formatPercent(strongestMomentum.priceChange1h)} in the last hour.`
        : "Sync pending."
    },
    {
      label: "Deepest Liquidity",
      value: deepestLiquidity ? deepestLiquidity.symbol : "-",
      detail: deepestLiquidity
        ? `${formatUsd(deepestLiquidity.liquidity)} available to absorb flow.`
        : "Sync pending."
    },
    {
      label: "Freshest Listing",
      value: freshestListing ? freshestListing.symbol : "-",
      detail: freshestListing
        ? `${freshestListing.ageMinutes} minutes since listing.`
        : "Sync pending."
    },
    {
      label: "Radar Quality",
      value: formatScore(payload.pulse?.avgSafety),
      detail: `${payload.endpointsUsed?.length || 0} Birdeye endpoints per refresh.`
    }
  ];

  elements.metricsGrid.innerHTML = metrics
    .map(
      (metric) => `
        <article class="metric-card">
          <span>${metric.label}</span>
          <strong>${metric.value}</strong>
          <p class="token-name">${metric.detail}</p>
        </article>
      `
    )
    .join("");

  renderSpotlight(leader);
  renderPulseStrip(tokens);
}

function syncView() {
  state.filteredTokens = [...state.tokens]
    .filter((token) => {
      const matchesQuery =
        !state.query ||
        token.symbol.toLowerCase().includes(state.query) ||
        token.name.toLowerCase().includes(state.query);
      const matchesVerdict = state.verdict === "all" || token.verdict === state.verdict;
      return matchesQuery && matchesVerdict;
    })
    .sort((left, right) => {
      const field = state.sortBy;
      return Number(right[field] || 0) - Number(left[field] || 0);
    });

  if (!state.filteredTokens.some((token) => token.address === state.selectedAddress)) {
    state.selectedAddress = state.filteredTokens[0]?.address || null;
  }

  renderTokenGrid();
  renderDetail();
}

function renderTokenGrid() {
  if (!state.filteredTokens.length) {
    elements.tokenGrid.innerHTML = `
      <div class="empty-state">
        <p class="eyebrow">No matches</p>
        <h3>Try widening the filters.</h3>
        <p class="token-name">The current search and verdict combination returned no candidates.</p>
      </div>
    `;
    return;
  }

  elements.tokenGrid.innerHTML = state.filteredTokens
    .map((token, index) => {
      const selectedClass = token.address === state.selectedAddress ? "is-selected" : "";
      return `
        <article class="token-card ${selectedClass}" data-address="${token.address}">
          <div class="token-header">
            <div class="token-identity">
              <div class="token-logo">
                ${renderLogo(token)}
              </div>
              <div>
                <p class="token-symbol">${index + 1}. ${escapeHtml(token.symbol)}</p>
                <p class="token-name">${escapeHtml(token.name)}</p>
              </div>
            </div>
            <div class="token-topline">
              <span class="score-chip">${token.flightScore}/100</span>
              <span class="verdict-chip ${verdictClassName(token.verdict)}">${escapeHtml(token.verdict)}</span>
            </div>
          </div>
          <p class="token-name">${escapeHtml(token.narrative)}</p>
          <div class="token-scorebar">
            <span style="width: ${Math.max(6, token.flightScore)}%"></span>
          </div>
          <div class="token-metrics">
            <div class="token-metric">
              <span>Quality</span>
              <strong>${token.securityScore}</strong>
            </div>
            <div class="token-metric">
              <span>Momentum</span>
              <strong>${token.momentumScore}</strong>
            </div>
            <div class="token-metric">
              <span>Liquidity</span>
              <strong>${formatUsd(token.liquidity)}</strong>
            </div>
            <div class="token-metric">
              <span>1h move</span>
              <strong>${formatPercent(token.priceChange1h)}</strong>
            </div>
          </div>
          <div class="token-footer">
            <div class="token-tags">
              ${token.sources.map((source) => `<span class="source-chip">${escapeHtml(formatSourceLabel(source))}</span>`).join("")}
            </div>
            <span class="token-meta">${formatRelativeAge(token.ageMinutes)}</span>
          </div>
        </article>
      `;
    })
    .join("");

  elements.tokenGrid.querySelectorAll(".token-card").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedAddress = card.dataset.address;
      renderTokenGrid();
      renderDetail();
    });
  });
}

function renderDetail() {
  const token = state.filteredTokens.find((entry) => entry.address === state.selectedAddress);
  if (!token) {
    elements.detailPanel.innerHTML = elements.detailEmpty.outerHTML;
    return;
  }

  elements.detailPanel.innerHTML = `
    <div class="detail-layout">
      <div class="detail-top">
        <div class="detail-headline">
          <div class="detail-logo">${renderLogo(token)}</div>
          <div class="detail-title">
            <h3>${escapeHtml(token.symbol)}</h3>
            <p class="detail-nameplate">${escapeHtml(token.name)}</p>
            <p>${escapeHtml(token.narrative)}</p>
          </div>
        </div>
        <span class="score-chip">Flight ${token.flightScore}</span>
      </div>

      <div class="detail-badges">
        <span class="verdict-chip ${verdictClassName(token.verdict)}">${escapeHtml(token.verdict)}</span>
        ${token.sources.map((source) => `<span class="source-chip">${escapeHtml(formatSourceLabel(source))}</span>`).join("")}
      </div>

      <div class="detail-score-grid">
        <div class="detail-block">
          <span>Quality score</span>
          <strong>${token.securityScore}</strong>
        </div>
        <div class="detail-block">
          <span>Momentum score</span>
          <strong>${token.momentumScore}</strong>
        </div>
        <div class="detail-block">
          <span>Structure score</span>
          <strong>${token.structureScore}</strong>
        </div>
      </div>

      <div class="detail-score-grid">
        <div class="detail-block">
          <span>Liquidity</span>
          <strong>${formatUsd(token.liquidity)}</strong>
        </div>
        <div class="detail-block">
          <span>24h volume</span>
          <strong>${formatUsd(token.volume24h)}</strong>
        </div>
        <div class="detail-block">
          <span>Market cap</span>
          <strong>${formatUsd(token.marketCap)}</strong>
        </div>
        <div class="detail-block">
          <span>1h move</span>
          <strong>${formatPercent(token.priceChange1h)}</strong>
        </div>
        <div class="detail-block">
          <span>24h move</span>
          <strong>${formatPercent(token.priceChange24h)}</strong>
        </div>
        <div class="detail-block">
          <span>Active wallets 1h</span>
          <strong>${formatInteger(token.holderMetrics?.uniqueWallet1h || 0)}</strong>
        </div>
        <div class="detail-block">
          <span>Holder count</span>
          <strong>${formatInteger(token.holderMetrics?.holderCount || 0)}</strong>
        </div>
        <div class="detail-block">
          <span>Markets</span>
          <strong>${formatInteger(token.holderMetrics?.numberMarkets || 0)}</strong>
        </div>
      </div>

      <div class="detail-narrative">${escapeHtml(token.narrative)}</div>

      <div class="detail-block">
        <span>Why it is surfacing now</span>
        <ul class="catalyst-list">
          ${
            token.catalysts.map((item) => `<li>${escapeHtml(item)}</li>`).join("") ||
            "<li>No catalyst summary is available yet.</li>"
          }
        </ul>
      </div>

      <div class="detail-block">
        <span>Risk notes</span>
        <ul class="flag-list">
          ${
            token.redFlags.map((item) => `<li>${escapeHtml(item)}</li>`).join("") ||
            "<li>No major red flags surfaced in this pass.</li>"
          }
        </ul>
      </div>

      <div class="detail-block">
        <span>Quality snapshot</span>
        <div class="detail-source-list">
          ${renderSecurityTag("Deep liquidity", token.securitySummary?.deepLiquidity)}
          ${renderSecurityTag("Broad holder base", token.securitySummary?.broadHolderBase)}
          ${renderSecurityTag("Wallet growth", token.securitySummary?.walletGrowth)}
          ${renderSecurityTag("Multi-market", token.securitySummary?.multiMarket)}
        </div>
      </div>
    </div>
  `;
}

function renderSpotlight(token) {
  if (!token) {
    elements.spotlightCard.innerHTML = `
      <p class="eyebrow">Radar Spotlight</p>
      <h3>Preparing the first ranked candidate...</h3>
      <p class="token-name">
        As soon as the live feed resolves, the strongest launch setup will appear here.
      </p>
    `;
    return;
  }

  elements.spotlightCard.innerHTML = `
    <p class="eyebrow">Radar Spotlight</p>
    <div class="spotlight-topline">
      <div class="spotlight-title">
        <div class="spotlight-logo">${renderLogo(token)}</div>
        <div>
          <h3>${escapeHtml(token.symbol)}</h3>
          <p class="token-name">${escapeHtml(token.name)}</p>
        </div>
      </div>
      <div class="spotlight-score">
        <span class="token-meta">Flight</span>
        <strong>${token.flightScore}</strong>
      </div>
    </div>
    <p class="spotlight-copy">${escapeHtml(token.narrative)}</p>
    <div class="detail-badges">
      <span class="verdict-chip ${verdictClassName(token.verdict)}">${escapeHtml(token.verdict)}</span>
      ${token.sources.map((source) => `<span class="source-chip">${escapeHtml(formatSourceLabel(source))}</span>`).join("")}
    </div>
    <div class="spotlight-grid">
      <div class="spotlight-metric">
        <span>Liquidity</span>
        <strong>${formatUsd(token.liquidity)}</strong>
      </div>
      <div class="spotlight-metric">
        <span>1h move</span>
        <strong>${formatPercent(token.priceChange1h)}</strong>
      </div>
      <div class="spotlight-metric">
        <span>Wallets 1h</span>
        <strong>${formatInteger(token.uniqueWallet1h)}</strong>
      </div>
      <div class="spotlight-metric">
        <span>Listed</span>
        <strong>${formatRelativeAge(token.ageMinutes)}</strong>
      </div>
    </div>
  `;
}

function renderPulseStrip(tokens) {
  const items = tokens.slice(0, 3);
  if (!items.length) {
    elements.pulseStrip.innerHTML = "";
    return;
  }

  elements.pulseStrip.innerHTML = items
    .map(
      (token) => `
        <article class="pulse-chip">
          <div class="pulse-chip-head">
            <strong>${escapeHtml(token.symbol)}</strong>
          </div>
          <p>${formatPercent(token.priceChange1h)} 1h move | ${formatUsd(token.liquidity)} liquidity</p>
        </article>
      `
    )
    .join("");
}

function renderSecurityTag(label, enabled) {
  const className = enabled ? "source-chip" : "verdict-chip";
  const suffix = enabled ? "strong" : "weak";
  return `<span class="${className}">${escapeHtml(label)}: ${suffix}</span>`;
}

function renderError(message) {
  elements.metricsGrid.innerHTML = "";
  elements.tokenGrid.innerHTML = `
    <div class="error-state">
      <p class="eyebrow">Dashboard error</p>
      <h3>We could not load Birdeye data.</h3>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
  elements.detailPanel.innerHTML = elements.detailEmpty.outerHTML;
}

function renderWarnings(warnings) {
  if (!warnings.length) {
    elements.warningStrip.innerHTML = "";
    return;
  }

  elements.warningStrip.innerHTML = `
    <div class="warning-strip">
      <strong>Data quality note</strong>
      <ul>
        ${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}
      </ul>
    </div>
  `;
}

function setStatus(mode, text) {
  elements.statusText.textContent = text;
  elements.statusText.className = `status-pill status-${mode}`;
}

function renderLogo(token) {
  if (token.logo) {
    return `<img src="${escapeAttribute(token.logo)}" alt="${escapeAttribute(token.symbol)} logo" />`;
  }
  return `<span>${escapeHtml(token.symbol.slice(0, 2).toUpperCase())}</span>`;
}

function formatUsd(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: numeric >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: numeric >= 1 ? 0 : 4
  }).format(numeric);
}

function formatPercent(value) {
  const numeric = Number(value || 0);
  const sign = numeric >= 0 ? "+" : "";
  return `${sign}${numeric.toFixed(1)}%`;
}

function formatScore(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric.toFixed(1) : "-";
}

function formatInteger(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? new Intl.NumberFormat("en-US").format(numeric) : "-";
}

function formatRelativeAge(ageMinutes) {
  const numeric = Number(ageMinutes);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return "Listing time n/a";
  }
  if (numeric < 60) {
    return `${Math.max(1, Math.round(numeric))}m ago`;
  }
  const hours = Math.floor(numeric / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatSourceLabel(source) {
  const normalized = String(source || "").trim().toLowerCase();
  switch (normalized) {
    case "new":
      return "New";
    case "trending":
      return "Trending";
    default:
      return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "Source";
  }
}

function verdictClassName(verdict) {
  switch (verdict) {
    case "Prime Setup":
      return "verdict-prime";
    case "Momentum Watch":
      return "verdict-momentum";
    case "Clean Watchlist":
      return "verdict-clean";
    case "High Beta":
      return "verdict-highbeta";
    default:
      return "verdict-speculative";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
