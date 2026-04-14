const STORAGE_KEY = "tc20_session_v2";
const TABS = ["tp", "sl", "pnl", "pct", "liq"];
const DEFAULT_MMR = { binance: 0.004, bybit: 0.005 };
const calculators = window.TradingCalculators;

if (!calculators) {
  throw new Error("Calculator engine failed to load.");
}

const authForm = document.getElementById("authForm");
const authModeBtn = document.getElementById("authModeBtn");
const authTitle = document.getElementById("authTitle");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authStatus = document.getElementById("authStatus");
const sessionState = document.getElementById("sessionState");
const logoutBtn = document.getElementById("logoutBtn");
const profileForm = document.getElementById("profileForm");
const profileStatus = document.getElementById("profileStatus");
const navButtons = Array.from(document.querySelectorAll("[data-nav-target]"));
const tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
const panels = Array.from(document.querySelectorAll(".panel"));
const panelsWrap = document.getElementById("panels");
const liqExchange = document.getElementById("liqExchange");
const liqMmr = document.getElementById("liqMmr");

let authMode = "login";
let activeTabIndex = 0;
let refreshInFlight = null;
let session = loadSession();

function loadSession() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") {
      return { accessToken: "", refreshToken: "", user: null };
    }
    return {
      accessToken: typeof parsed.accessToken === "string" ? parsed.accessToken : "",
      refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : "",
      user: parsed.user || null,
    };
  } catch (_error) {
    return { accessToken: "", refreshToken: "", user: null };
  }
}

function saveSession(nextSession) {
  session = {
    accessToken: nextSession.accessToken || "",
    refreshToken: nextSession.refreshToken || "",
    user: nextSession.user || null,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  refreshSessionUI();
}

function clearSession() {
  session = { accessToken: "", refreshToken: "", user: null };
  localStorage.removeItem(STORAGE_KEY);
  refreshSessionUI();
}

function toNumber(value) {
  return Number.parseFloat(value);
}

function fmtNumber(value, digits = 2) {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function fmtUsd(value) {
  return `$${fmtNumber(value, 2)}`;
}

function setStatus(el, message, type = "") {
  el.textContent = message;
  el.classList.remove("good", "bad");
  if (type) {
    el.classList.add(type);
  }
}

function setResult(id, message, type = "") {
  const el = document.getElementById(id);
  el.innerHTML = message;
  el.classList.remove("good", "bad");
  if (type) {
    el.classList.add(type);
  }
}

async function refreshAccessToken() {
  if (!session.refreshToken) {
    clearSession();
    return false;
  }

  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    try {
      const response = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        clearSession();
        return false;
      }

      saveSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user || session.user,
      });
      return true;
    } catch (_error) {
      clearSession();
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function api(path, options = {}, allowRefreshRetry = true) {
  const headers = { ...(options.headers || {}) };
  if (!headers["Content-Type"] && options.body) {
    headers["Content-Type"] = "application/json";
  }
  if (session.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (response.status === 401 && allowRefreshRetry && session.refreshToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return api(path, options, false);
    }
  }

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function refreshSessionUI() {
  const isSignedIn = Boolean(session.user && (session.accessToken || session.refreshToken));
  sessionState.textContent = isSignedIn
    ? `${session.user.displayName} (${session.user.role.replace("_", " ")})`
    : "Signed out";
  logoutBtn.disabled = !isSignedIn;
  navButtons.forEach((btn) => {
    if (btn.dataset.navTarget === "profile") {
      btn.disabled = !isSignedIn;
    }
  });

  if (isSignedIn) {
    document.getElementById("profileDisplayName").value = session.user.displayName || "";
    document.getElementById("profileEmail").value = session.user.email || "";
    document.getElementById("profileRole").value = session.user.role || "";
    document.getElementById("profileStyle").value = session.user.preferredTradingStyle || "scalp";
    document.getElementById("profileWallet").value = session.user.walletAddress || "";
    document.getElementById("profileAvatarUrl").value = session.user.avatarUrl || "";
    setStatus(profileStatus, "Profile loaded.", "good");
  } else {
    profileForm.reset();
    setStatus(profileStatus, "Sign in to manage your profile.");
  }
}

function setAuthMode(mode) {
  authMode = mode;
  document.body.classList.toggle("mode-register", authMode === "register");

  if (authMode === "register") {
    authTitle.textContent = "Create account";
    authSubmitBtn.textContent = "Register";
    authModeBtn.textContent = "Already have an account?";
  } else {
    authTitle.textContent = "Welcome back";
    authSubmitBtn.textContent = "Sign In";
    authModeBtn.textContent = "Need an account?";
  }
  setStatus(authStatus, "");
}

function setActiveTab(nextIndex) {
  activeTabIndex = (nextIndex + TABS.length) % TABS.length;
  const activeTab = TABS[activeTabIndex];

  tabButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === activeTab);
  });
  panels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === activeTab);
  });
}

function setupTabNavigation() {
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = TABS.indexOf(btn.dataset.tab);
      if (idx >= 0) {
        setActiveTab(idx);
      }
    });
  });

  let startX = 0;
  let startY = 0;
  panelsWrap.addEventListener(
    "touchstart",
    (event) => {
      startX = event.changedTouches[0].screenX;
      startY = event.changedTouches[0].screenY;
    },
    { passive: true }
  );

  panelsWrap.addEventListener(
    "touchend",
    (event) => {
      const endX = event.changedTouches[0].screenX;
      const endY = event.changedTouches[0].screenY;
      const dx = endX - startX;
      const dy = endY - startY;

      if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy)) {
        setActiveTab(dx < 0 ? activeTabIndex + 1 : activeTabIndex - 1);
      }
    },
    { passive: true }
  );
}

function bindCalculatorForms() {
  document.getElementById("tpForm").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const result = calculators.calculateTakeProfit({
        entryPrice: toNumber(document.getElementById("tpEntry").value),
        takeProfitPrice: toNumber(document.getElementById("tpTarget").value),
        positionSize: toNumber(document.getElementById("tpSize").value),
        positionType: document.getElementById("tpType").value,
        leverage: toNumber(document.getElementById("tpLeverage").value),
        feePercent: toNumber(document.getElementById("tpFee").value),
        stopLossPrice: document.getElementById("tpStop").value,
      });

      const rrText =
        result.riskRewardRatio === null
          ? result.riskRewardHint
          : `R:R: ${fmtNumber(result.riskRewardRatio, 2)} (${result.riskRewardHint})`;
      const type = result.profitUsd >= 0 ? "good" : "bad";

      setResult(
        "tpResult",
        `Profit: <strong>${fmtUsd(result.profitUsd)}</strong><br>ROI: <strong>${fmtNumber(
          result.roiPercent,
          2
        )}%</strong><br>Fee Cost: ${fmtUsd(result.feeUsd)}<br>${rrText}`,
        type
      );
    } catch (error) {
      setResult("tpResult", error.message, "bad");
    }
  });

  document.getElementById("slForm").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const result = calculators.calculateStopLoss({
        entryPrice: toNumber(document.getElementById("slEntry").value),
        stopLossPrice: toNumber(document.getElementById("slStop").value),
        positionSize: toNumber(document.getElementById("slSize").value),
        positionType: document.getElementById("slType").value,
        leverage: toNumber(document.getElementById("slLeverage").value),
        feePercent: toNumber(document.getElementById("slFee").value),
      });

      setResult(
        "slResult",
        `Estimated Loss: <strong>${fmtUsd(result.lossUsd)}</strong><br>% of Capital Lost: <strong>${fmtNumber(
          result.capitalLossPercent,
          2
        )}%</strong><br>Fee Cost: ${fmtUsd(result.feeUsd)}`,
        "bad"
      );
    } catch (error) {
      setResult("slResult", error.message, "bad");
    }
  });

  document.getElementById("pnlForm").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const result = calculators.calculatePnL({
        entryPrice: toNumber(document.getElementById("pnlEntry").value),
        exitPrice: toNumber(document.getElementById("pnlExit").value),
        positionSize: toNumber(document.getElementById("pnlSize").value),
        positionType: document.getElementById("pnlType").value,
        leverage: toNumber(document.getElementById("pnlLeverage").value),
        feePercent: toNumber(document.getElementById("pnlFee").value),
      });
      const type = result.netPnlUsd >= 0 ? "good" : "bad";

      setResult(
        "pnlResult",
        `Net PnL: <strong>${fmtUsd(result.netPnlUsd)}</strong><br>ROI: <strong>${fmtNumber(
          result.roiPercent,
          2
        )}%</strong><br>Gross PnL: ${fmtUsd(result.grossPnlUsd)}<br>Fees: ${fmtUsd(
          result.feeUsd
        )}`,
        type
      );
    } catch (error) {
      setResult("pnlResult", error.message, "bad");
    }
  });

  document.getElementById("pctForm").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const result = calculators.calculatePercentageChange({
        initialValue: toNumber(document.getElementById("pctInitial").value),
        finalValue: toNumber(document.getElementById("pctFinal").value),
      });

      setResult(
        "pctResult",
        `Change: <strong>${fmtNumber(result.percentageChange, 2)}%</strong><br>Absolute Difference: <strong>${fmtNumber(
          result.absoluteDifference,
          4
        )}</strong>`,
        result.isGain ? "good" : "bad"
      );
    } catch (error) {
      setResult("pctResult", error.message, "bad");
    }
  });

  liqMmr.value = String(DEFAULT_MMR[liqExchange.value]);
  liqExchange.addEventListener("change", () => {
    liqMmr.value = String(DEFAULT_MMR[liqExchange.value]);
  });

  document.getElementById("liqForm").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const result = calculators.calculateLiquidation({
        exchange: liqExchange.value,
        positionType: document.getElementById("liqType").value,
        entryPrice: toNumber(document.getElementById("liqEntry").value),
        leverage: toNumber(document.getElementById("liqLeverage").value),
        margin: toNumber(document.getElementById("liqMargin").value),
        maintenanceMarginRate: toNumber(document.getElementById("liqMmr").value),
      });

      const warning = result.isHighRisk
        ? "Warning: liquidation is very close to entry."
        : "Buffer: liquidation distance is relatively safer.";

      setResult(
        "liqResult",
        `Liquidation Price: <strong>${fmtNumber(result.liquidationPrice, 6)}</strong><br>Distance from Entry: <strong>${fmtNumber(
          result.distanceFromEntryPercent,
          2
        )}%</strong><br>${warning}`,
        result.isHighRisk ? "bad" : "good"
      );
    } catch (error) {
      setResult("liqResult", error.message, "bad");
    }
  });
}

function bindAuth() {
  authModeBtn.addEventListener("click", () => {
    setAuthMode(authMode === "login" ? "register" : "login");
  });

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus(authStatus, "Working...");

    try {
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;
      let data;

      if (authMode === "register") {
        const displayName = document.getElementById("displayName").value.trim();
        const role = document.getElementById("role").value;
        data = await api("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password, displayName, role }),
        });
      } else {
        data = await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
      }

      saveSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
      });
      setStatus(authStatus, "Authentication successful.", "good");
      authForm.reset();
      setAuthMode("login");
    } catch (error) {
      setStatus(authStatus, error.message, "bad");
    }
  });

  logoutBtn.addEventListener("click", async () => {
    try {
      if (session.accessToken && session.refreshToken) {
        await api(
          "/api/auth/logout",
          {
            method: "POST",
            body: JSON.stringify({ refreshToken: session.refreshToken }),
          },
          true
        );
      }
    } catch (_error) {
      // Best effort logout request.
    } finally {
      clearSession();
      setStatus(authStatus, "Signed out.");
    }
  });
}

function bindProfile() {
  profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!session.accessToken && !session.refreshToken) {
      setStatus(profileStatus, "Sign in first.", "bad");
      return;
    }

    try {
      const body = {
        displayName: document.getElementById("profileDisplayName").value.trim(),
        preferredTradingStyle: document.getElementById("profileStyle").value,
        walletAddress: document.getElementById("profileWallet").value.trim(),
        avatarUrl: document.getElementById("profileAvatarUrl").value.trim(),
      };

      const data = await api("/api/profile", {
        method: "PUT",
        body: JSON.stringify(body),
      });

      saveSession({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        user: data.user,
      });
      setStatus(profileStatus, "Profile saved.", "good");
    } catch (error) {
      setStatus(profileStatus, error.message, "bad");
    }
  });
}

function bindTopNavigation() {
  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.navTarget;
      const signedIn = Boolean(session.user && (session.accessToken || session.refreshToken));
      if (target === "profile" && !signedIn) {
        setStatus(authStatus, "Sign in first to access profile.", "bad");
        return;
      }

      navButtons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      const section = document.querySelector(`[data-section="${target}"]`);
      if (section) {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

async function rehydrateSession() {
  if (!session.accessToken && !session.refreshToken) {
    refreshSessionUI();
    return;
  }

  if (!session.accessToken && session.refreshToken) {
    await refreshAccessToken();
  }

  try {
    const data = await api("/api/auth/me", { method: "GET" });
    saveSession({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: data.user,
    });
  } catch (_error) {
    clearSession();
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
}

async function boot() {
  setAuthMode("login");
  setActiveTab(0);
  setupTabNavigation();
  bindCalculatorForms();
  bindAuth();
  bindProfile();
  bindTopNavigation();
  registerServiceWorker();
  await rehydrateSession();
}

boot();
