try {
  require("dotenv").config();
} catch (_error) {
  // dotenv is optional in environments that already provide env vars.
}

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const mongoose = require("mongoose");

const User = require("./models/User");
const RefreshSession = require("./models/RefreshSession");

const app = express();
app.set("trust proxy", 1);

const PORT = Number(process.env.PORT) || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

const ACCESS_TOKEN_TTL_SECONDS =
  Number(process.env.ACCESS_TOKEN_TTL_SECONDS) || 60 * 15;
const REFRESH_TOKEN_TTL_SECONDS =
  Number(process.env.REFRESH_TOKEN_TTL_SECONDS) || 60 * 60 * 24 * 7;
const JWT_SECRET =
  process.env.JWT_SECRET ||
  "replace-this-dev-secret-immediately-before-production";

const ALLOWED_ROLES = new Set(["crypto_trader", "forex_trader", "tutor"]);
const ALLOWED_STYLES = new Set(["scalp", "day_trade", "swing"]);

const AUTH_WINDOW_MS = 10 * 60 * 1000;
const AUTH_WINDOW_MAX = 40;
const API_WINDOW_MS = 15 * 60 * 1000;
const API_WINDOW_MAX = 240;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

const apiBuckets = new Map();
const authBuckets = new Map();
const loginFailures = new Map();

if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI in .env");
  process.exit(1);
}

app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    );
  }
  next();
});

app.use(express.static(path.join(__dirname, "public")));
app.use("/Fonts", express.static(path.join(__dirname, "Fonts")));

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function getClientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || "unknown");
}

function safeEqualStrings(left, right) {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const mod = padded.length % 4;
  const normalized = mod ? padded + "=".repeat(4 - mod) : padded;
  return Buffer.from(normalized, "base64").toString("utf8");
}

function signToken(payload, ttlSeconds) {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(
    JSON.stringify({
      ...payload,
      iat: nowSeconds(),
      exp: nowSeconds() + ttlSeconds,
    })
  );

  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed token");
  }

  const [header, body, signature] = parts;
  const expectedSignature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  if (!safeEqualStrings(expectedSignature, signature)) {
    throw new Error("Invalid token signature");
  }

  const payload = JSON.parse(base64UrlDecode(body));
  if (!payload.exp || payload.exp <= nowSeconds()) {
    throw new Error("Token expired");
  }

  return payload;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function hashPassword(password, salt) {
  return crypto
    .pbkdf2Sync(password, salt, 120000, 64, "sha512")
    .toString("hex");
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);
  return { passwordHash, passwordSalt: salt };
}

function verifyPassword(password, passwordSalt, passwordHash) {
  const candidateHash = hashPassword(password, passwordSalt);
  const candidate = Buffer.from(candidateHash, "hex");
  const stored = Buffer.from(passwordHash, "hex");
  if (candidate.length !== stored.length) {
    return false;
  }
  return crypto.timingSafeEqual(candidate, stored);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isWalletAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function sanitizeUser(userDoc) {
  return {
    id: userDoc._id.toString(),
    email: userDoc.email,
    displayName: userDoc.displayName,
    role: userDoc.role,
    avatarUrl: userDoc.avatarUrl || "",
    walletAddress: userDoc.walletAddress || "",
    preferredTradingStyle: userDoc.preferredTradingStyle || "scalp",
    createdAt: userDoc.createdAt,
    updatedAt: userDoc.updatedAt,
  };
}

function cleanupFixedWindowBuckets(map, now) {
  for (const [key, entry] of map.entries()) {
    if (!entry || entry.resetAt <= now) {
      map.delete(key);
    }
  }
}

function fixedWindowRateLimit(map, windowMs, maxHits, keyBuilder) {
  return (req, res, next) => {
    const now = Date.now();
    const key = keyBuilder(req);
    const existing = map.get(key);

    if (!existing || existing.resetAt <= now) {
      map.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (existing.count >= maxHits) {
      const retrySeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retrySeconds));
      return res.status(429).json({
        error: "Too many requests. Please retry later.",
        retryAfterSeconds: retrySeconds,
      });
    }

    existing.count += 1;
    map.set(key, existing);
    return next();
  };
}

function getAuthFailureKey(req, email) {
  return `${getClientIp(req)}::${String(email || "").toLowerCase()}`;
}

function getFailureState(key) {
  const now = Date.now();
  const state = loginFailures.get(key);

  if (!state) {
    const fresh = { windowStart: now, failCount: 0, lockUntil: 0 };
    loginFailures.set(key, fresh);
    return fresh;
  }

  if (state.lockUntil && state.lockUntil <= now) {
    const unlocked = { windowStart: now, failCount: 0, lockUntil: 0 };
    loginFailures.set(key, unlocked);
    return unlocked;
  }

  if (now - state.windowStart > LOGIN_ATTEMPT_WINDOW_MS) {
    const reset = { windowStart: now, failCount: 0, lockUntil: 0 };
    loginFailures.set(key, reset);
    return reset;
  }

  return state;
}

function getAuthLockInfo(req, email) {
  const key = getAuthFailureKey(req, email);
  const state = getFailureState(key);
  const now = Date.now();
  if (!state.lockUntil || state.lockUntil <= now) {
    return { isLocked: false, retryAfterSeconds: 0 };
  }
  return {
    isLocked: true,
    retryAfterSeconds: Math.max(1, Math.ceil((state.lockUntil - now) / 1000)),
  };
}

function registerAuthFailure(req, email) {
  const key = getAuthFailureKey(req, email);
  const state = getFailureState(key);
  const now = Date.now();

  state.failCount += 1;
  if (state.failCount >= LOGIN_MAX_FAILURES) {
    state.lockUntil = now + LOGIN_LOCK_MS;
  }
  loginFailures.set(key, state);

  if (!state.lockUntil || state.lockUntil <= now) {
    return { isLocked: false, retryAfterSeconds: 0 };
  }
  return {
    isLocked: true,
    retryAfterSeconds: Math.max(1, Math.ceil((state.lockUntil - now) / 1000)),
  };
}

function clearAuthFailures(req, email) {
  loginFailures.delete(getAuthFailureKey(req, email));
}

function getAccessTokenFromRequest(req) {
  const authHeader = String(req.headers.authorization || "");
  if (!authHeader.startsWith("Bearer ")) {
    return "";
  }
  return authHeader.slice("Bearer ".length);
}

async function requireAccessAuth(req, res, next) {
  try {
    const token = getAccessTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const payload = verifyToken(token);
    if (payload.type !== "access") {
      return res.status(401).json({ error: "Invalid access token" });
    }

    const user = await User.findById(payload.sub);
    if (!user) {
      return res.status(401).json({ error: "Invalid session" });
    }

    req.user = user;
    req.accessTokenPayload = payload;
    return next();
  } catch (_error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

async function createSessionTokens(user, req, rotatedFromTokenId = "") {
  const userId = user._id.toString();
  const refreshTokenId = crypto.randomUUID();
  const refreshToken = signToken(
    { sub: userId, sid: refreshTokenId, type: "refresh" },
    REFRESH_TOKEN_TTL_SECONDS
  );
  const accessToken = signToken(
    { sub: userId, email: user.email, type: "access" },
    ACCESS_TOKEN_TTL_SECONDS
  );

  await RefreshSession.create({
    userId: user._id,
    tokenId: refreshTokenId,
    tokenHash: hashToken(refreshToken),
    createdByIp: getClientIp(req),
    userAgent: String(req.headers["user-agent"] || ""),
    rotatedFromTokenId: rotatedFromTokenId || "",
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
  });

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenExpiresInSeconds: REFRESH_TOKEN_TTL_SECONDS,
    refreshTokenId,
  };
}

async function revokeRefreshSessionByToken(token, fallbackUserId = "") {
  try {
    const payload = verifyToken(token);
    if (payload.type !== "refresh" || !payload.sid || !payload.sub) {
      return;
    }
    if (fallbackUserId && payload.sub !== fallbackUserId) {
      return;
    }
    await RefreshSession.updateOne(
      { tokenId: payload.sid, userId: payload.sub, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
  } catch (_error) {
    // Invalid refresh token can be ignored during logout/revoke best-effort.
  }
}

const apiRateLimit = fixedWindowRateLimit(
  apiBuckets,
  API_WINDOW_MS,
  API_WINDOW_MAX,
  (req) => getClientIp(req)
);
const authRateLimit = fixedWindowRateLimit(
  authBuckets,
  AUTH_WINDOW_MS,
  AUTH_WINDOW_MAX,
  (req) => getClientIp(req)
);

app.use("/api", apiRateLimit);

app.get("/api/health", (_req, res) => {
  return res.json({ ok: true, service: "trading-calc-2.0" });
});

app.post("/api/auth/register", authRateLimit, async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const displayName = String(req.body.displayName || "").trim();
    const role = String(req.body.role || "").trim();

    if (!isEmail(email)) {
      return res.status(400).json({ error: "Invalid email address" });
    }
    if (password.length < 8) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters" });
    }
    if (!displayName || displayName.length > 60) {
      return res
        .status(400)
        .json({ error: "Display name is required (max 60 chars)" });
    }
    if (!ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ error: "Invalid role selected" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: "Email is already registered" });
    }

    const { passwordHash, passwordSalt } = createPasswordRecord(password);
    const user = await User.create({
      email,
      passwordHash,
      passwordSalt,
      displayName,
      role,
    });

    const tokenBundle = await createSessionTokens(user, req);
    return res.status(201).json({
      accessToken: tokenBundle.accessToken,
      refreshToken: tokenBundle.refreshToken,
      accessTokenExpiresInSeconds: tokenBundle.accessTokenExpiresInSeconds,
      refreshTokenExpiresInSeconds: tokenBundle.refreshTokenExpiresInSeconds,
      user: sanitizeUser(user),
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to register user",
      details: error.message,
    });
  }
});

app.post("/api/auth/login", authRateLimit, async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!isEmail(email) || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const lockInfo = getAuthLockInfo(req, email);
    if (lockInfo.isLocked) {
      res.setHeader("Retry-After", String(lockInfo.retryAfterSeconds));
      return res.status(429).json({
        error: "Too many failed login attempts. Try again later.",
        retryAfterSeconds: lockInfo.retryAfterSeconds,
      });
    }

    const user = await User.findOne({ email }).select("+passwordHash +passwordSalt");
    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      const failure = registerAuthFailure(req, email);
      if (failure.isLocked) {
        res.setHeader("Retry-After", String(failure.retryAfterSeconds));
        return res.status(429).json({
          error: "Too many failed login attempts. Try again later.",
          retryAfterSeconds: failure.retryAfterSeconds,
        });
      }
      return res.status(401).json({ error: "Invalid credentials" });
    }

    clearAuthFailures(req, email);
    const tokenBundle = await createSessionTokens(user, req);
    return res.status(200).json({
      accessToken: tokenBundle.accessToken,
      refreshToken: tokenBundle.refreshToken,
      accessTokenExpiresInSeconds: tokenBundle.accessTokenExpiresInSeconds,
      refreshTokenExpiresInSeconds: tokenBundle.refreshTokenExpiresInSeconds,
      user: sanitizeUser(user),
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to login", details: error.message });
  }
});

app.post("/api/auth/refresh", authRateLimit, async (req, res) => {
  try {
    const refreshToken = String(req.body.refreshToken || "");
    if (!refreshToken) {
      return res.status(400).json({ error: "refreshToken is required" });
    }

    let payload;
    try {
      payload = verifyToken(refreshToken);
    } catch (_error) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    if (payload.type !== "refresh" || !payload.sid || !payload.sub) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    const session = await RefreshSession.findOne({
      tokenId: payload.sid,
      userId: payload.sub,
      revokedAt: null,
    });

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      return res.status(401).json({ error: "Refresh session expired" });
    }

    const incomingHash = hashToken(refreshToken);
    if (!safeEqualStrings(session.tokenHash, incomingHash)) {
      session.revokedAt = new Date();
      await session.save();
      return res.status(401).json({ error: "Invalid refresh session" });
    }

    const user = await User.findById(payload.sub);
    if (!user) {
      session.revokedAt = new Date();
      await session.save();
      return res.status(401).json({ error: "Invalid refresh session" });
    }

    const tokenBundle = await createSessionTokens(user, req, session.tokenId);
    session.revokedAt = new Date();
    session.replacedByTokenId = tokenBundle.refreshTokenId;
    await session.save();

    return res.json({
      accessToken: tokenBundle.accessToken,
      refreshToken: tokenBundle.refreshToken,
      accessTokenExpiresInSeconds: tokenBundle.accessTokenExpiresInSeconds,
      refreshTokenExpiresInSeconds: tokenBundle.refreshTokenExpiresInSeconds,
      user: sanitizeUser(user),
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to refresh token", details: error.message });
  }
});

app.post("/api/auth/logout", requireAccessAuth, async (req, res) => {
  try {
    const refreshToken = String(req.body.refreshToken || "");
    const revokeAll = Boolean(req.body.revokeAllDevices);

    if (revokeAll) {
      await RefreshSession.updateMany(
        { userId: req.user._id, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
      return res.json({ ok: true });
    }

    if (refreshToken) {
      await revokeRefreshSessionByToken(refreshToken, req.user._id.toString());
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Failed to logout", details: error.message });
  }
});

app.get("/api/auth/me", requireAccessAuth, (req, res) => {
  return res.json({ user: sanitizeUser(req.user) });
});

app.put("/api/profile", requireAccessAuth, async (req, res) => {
  try {
    const displayName = req.body.displayName;
    const avatarUrl = req.body.avatarUrl;
    const walletAddress = req.body.walletAddress;
    const preferredTradingStyle = req.body.preferredTradingStyle;

    if (typeof displayName === "string") {
      const trimmedName = displayName.trim();
      if (!trimmedName || trimmedName.length > 60) {
        return res
          .status(400)
          .json({ error: "Display name is required (max 60 chars)" });
      }
      req.user.displayName = trimmedName;
    }

    if (typeof avatarUrl === "string") {
      req.user.avatarUrl = avatarUrl.trim();
    }

    if (typeof walletAddress === "string") {
      const trimmedWallet = walletAddress.trim();
      if (trimmedWallet && !isWalletAddress(trimmedWallet)) {
        return res.status(400).json({
          error: "Wallet address must match 0x + 40 hex characters",
        });
      }
      req.user.walletAddress = trimmedWallet;
    }

    if (typeof preferredTradingStyle === "string") {
      if (!ALLOWED_STYLES.has(preferredTradingStyle)) {
        return res.status(400).json({ error: "Invalid trading style selected" });
      }
      req.user.preferredTradingStyle = preferredTradingStyle;
    }

    await req.user.save();
    return res.json({ user: sanitizeUser(req.user) });
  } catch (error) {
    return res.status(500).json({ error: "Failed to update profile", details: error.message });
  }
});

app.get(/^\/(?!api).*/, (_req, res) => {
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

function cleanupMemoryStores() {
  const now = Date.now();
  cleanupFixedWindowBuckets(apiBuckets, now);
  cleanupFixedWindowBuckets(authBuckets, now);

  for (const [key, state] of loginFailures.entries()) {
    if (!state) {
      loginFailures.delete(key);
      continue;
    }
    const expiredWindow = now - state.windowStart > LOGIN_ATTEMPT_WINDOW_MS;
    const unlocked = !state.lockUntil || state.lockUntil <= now;
    if (expiredWindow && unlocked) {
      loginFailures.delete(key);
    }
  }
}

const memoryCleanupInterval = setInterval(
  cleanupMemoryStores,
  Math.min(API_WINDOW_MS, LOGIN_ATTEMPT_WINDOW_MS)
);
if (typeof memoryCleanupInterval.unref === "function") {
  memoryCleanupInterval.unref();
}

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("MongoDB connected");

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Server failed to start:", error.message);
    process.exit(1);
  }
}

startServer();
