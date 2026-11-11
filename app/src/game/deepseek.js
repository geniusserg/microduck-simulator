// DeepSeek chat integration for the duck-duck conversation feature.
//
// The DeepSeek API is OpenAI-compatible (https://api.deepseek.com), bearer
// token auth. The key is the user's own and never ships in the bundle: it
// is kept in localStorage, with build-time / URL overrides for local dev.
//
// generateDialogue() asks the model for a short, alternating two-duck chat
// and normalizes whatever JSON comes back into `[{duck: 0|1, text}]` with a
// hard per-duck line cap, so a misbehaving model can never run the scene
// off the rails.

const KEY_STORE = "microduck-deepseek-key";
const ENDPOINT = "https://api.deepseek.com/chat/completions";
// Current DeepSeek chat model (see api-docs.deepseek.com). Overridable via
// ?deepseek-model= for local experiments.
export const DEFAULT_MODEL = "deepseek-flash";
export const MODEL =
  new URLSearchParams(typeof location !== "undefined" ? location.search : "").get("deepseek-model") ||
  DEFAULT_MODEL;

// Per-duck hard cap on lines. The prompt targets 6, and lets the model go to
// 10 only to close the conversation cleanly; the cap here is the backstop.
export const MAX_LINES_PER_DUCK = 10;
export const TARGET_LINES_PER_DUCK = 6;

// Emotions the model may tag a line with. Each maps to the duck's own
// voice-bank clips (angry.wav, curious.wav, ...) so the duck expresses the
// line with its real microduck sounds instead of synthetic speech.
export const EMOTIONS = [
  "neutral",
  "happy",
  "excited",
  "curious",
  "sad",
  "angry",
  "amused",
  "surprised",
];

export function getApiKey() {
  try {
    return localStorage.getItem(KEY_STORE) || "";
  } catch {
    return "";
  }
}

export function setApiKey(key) {
  const k = String(key || "").trim();
  try {
    if (k) localStorage.setItem(KEY_STORE, k);
    else localStorage.removeItem(KEY_STORE);
  } catch {
    /* private mode */
  }
  return k;
}

export function clearApiKey() {
  try {
    localStorage.removeItem(KEY_STORE);
  } catch {
    /* private mode */
  }
}

// ── Spend guard: prepaid + client-side caps ──────────────────────────────
// DeepSeek is a PREPAID API: it cannot go negative or accrue debt — once a
// balance is empty the API answers 402 "Insufficient Balance" and simply
// stops. On top of that, the sim enforces a daily token budget and a
// cooldown between chats (both persisted in this browser) so a shared or
// public build can never drain a personal balance quickly. The key itself
// never leaves the browser except in the request to api.deepseek.com.
const SETTINGS_KEY = "microduck-deepseek-settings";
const USAGE_KEY = "microduck-deepseek-usage";
export const DEFAULT_DAILY_TOKENS = 2000;
export const DEFAULT_COOLDOWN_MS = 15000;

const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function getSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return {
      dailyTokens:
        Number.isFinite(s.dailyTokens) && s.dailyTokens > 0 ? s.dailyTokens : DEFAULT_DAILY_TOKENS,
      cooldownMs:
        Number.isFinite(s.cooldownMs) && s.cooldownMs >= 0 ? s.cooldownMs : DEFAULT_COOLDOWN_MS,
    };
  } catch {
    return { dailyTokens: DEFAULT_DAILY_TOKENS, cooldownMs: DEFAULT_COOLDOWN_MS };
  }
}

export function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  return next;
}

function readUsage() {
  try {
    const u = JSON.parse(localStorage.getItem(USAGE_KEY) || "{}");
    if (u.day !== dayKey()) return { day: dayKey(), tokens: 0, lastAt: 0 };
    return { day: u.day, tokens: u.tokens || 0, lastAt: u.lastAt || 0 };
  } catch {
    return { day: dayKey(), tokens: 0, lastAt: 0 };
  }
}

export function recordUsage(tokens) {
  const u = readUsage();
  u.tokens += Math.max(0, Math.round(tokens || 0));
  u.lastAt = Date.now();
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(u));
  } catch {
    /* private mode */
  }
}

export function resetUsage() {
  try {
    localStorage.removeItem(USAGE_KEY);
  } catch {
    /* private mode */
  }
}

// { used, limit, cooldownLeftMs }
export function usageSummary() {
  const u = readUsage();
  const s = getSettings();
  return {
    used: u.tokens,
    limit: s.dailyTokens,
    cooldownLeftMs: Math.max(0, u.lastAt + s.cooldownMs - Date.now()),
  };
}

export function canChat() {
  const u = readUsage();
  const s = getSettings();
  const left = u.lastAt + s.cooldownMs - Date.now();
  if (left > 0) {
    return { ok: false, reason: `Chat is cooling down (${Math.ceil(left / 1000)}s).` };
  }
  if (u.tokens >= s.dailyTokens) {
    return { ok: false, reason: `Daily chat budget reached (${s.dailyTokens} tokens). It resets at midnight.` };
  }
  return { ok: true };
}

// Rough token estimate when the API response omits the usage field.
function estimateTokens(body, content) {
  const chars = JSON.stringify(body).length + String(content ?? "").length;
  return Math.ceil(chars / 4);
}

// Build-time key (VITE_DEEPSEEK_API_KEY), then ?deepseek-key=, then the
// stored key. Build-time keys are for private deployments; the stored key
// is the normal path for the public sim.
function resolveApiKey() {
  const fromStore = getApiKey();
  if (fromStore) return fromStore;
  const fromUrl = new URLSearchParams(typeof location !== "undefined" ? location.search : "").get("deepseek-key");
  if (fromUrl) return fromUrl;
  try {
    return import.meta.env?.VITE_DEEPSEEK_API_KEY || "";
  } catch {
    return "";
  }
}

// ── Prompt ──────────────────────────────────────────────────────────────
function buildSystem(whiteName, blueName) {
  return [
    `You are writing the dialogue for two rubber-duck robots in a toy simulator.`,
    `One duck is "${whiteName}" and the other is "${blueName}". They just waddled together to chat.`,
    `Write a warm, playful, natural back-and-forth between them. Strictly alternate speakers.`,
    `Write every line of dialogue in Russian (Cyrillic).`,
    `Each duck speaks at most ${TARGET_LINES_PER_DUCK} lines. If a final line is needed to end the`,
    `conversation gracefully (a greeting, small talk, then a goodbye), you may go up to`,
    `${MAX_LINES_PER_DUCK} lines per duck, but never more, and never leave the chat hanging.`,
    `Keep each line short and spoken (roughly 3 to 14 words). Duck-appropriate topics: the pond,`,
    `the weather, snacks, their little sports games, waddling. No humans, no code, no lists.`,
    `Each line also carries an "emotion" - the duck's feeling for that line - chosen from exactly`,
    `this set: ${EMOTIONS.join(", ")}. Vary them to match the flow of the chat.`,
    `Respond with ONLY a JSON object, no commentary, in exactly this shape:`,
    `{"lines":[{"duck":"white","line":"...","emotion":"happy"},{"duck":"blue","line":"...","emotion":"curious"}]}`,
    `"duck" is either "white" or "blue" and must alternate.`,
  ].join(" ");
}

const USER_PROMPT = "Две утки встретились на лугу. Напиши их короткий разговор на русском.";

// ── Response normalization ──────────────────────────────────────────────
// Map model speaker tokens ("white"/"blue", "0"/"1", "a"/"b") to 0/1.
function duckIndex(token) {
  const t = String(token ?? "").trim().toLowerCase();
  if (["white", "0", "a", "first", "left", "duck1"].includes(t)) return 0;
  if (["blue", "1", "b", "second", "right", "duck2"].includes(t)) return 1;
  return null;
}

// Validate the model's emotion tag against the allowed set; anything else
// (or missing) falls back to neutral.
function normalizeEmotion(token) {
  const t = String(token ?? "").trim().toLowerCase();
  return EMOTIONS.includes(t) ? t : "neutral";
}

// Extract the first JSON object out of a possibly fenced / prefixed reply.
export function extractJson(text) {
  const s = String(text ?? "");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : s;
  const open = candidate.indexOf("{");
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < candidate.length; i++) {
    const c = candidate[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        const slice = candidate.slice(open, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          return null;
        }
      }
    }
  }
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

// Normalize arbitrary model output into `[{duck:0|1, text}]`. Strict
// alternation is enforced: the first speaker is whatever the model said
// (or "white"), then every line flips to the other duck — a two-duck chat
// is a back-and-forth by definition, even if the model forgot to alternate.
// Each duck is hard-capped at MAX_LINES_PER_DUCK.
export function normalizeDialogue(raw) {
  const lines = Array.isArray(raw?.lines) ? raw.lines : Array.isArray(raw) ? raw : [];
  const out = [];
  const counts = [0, 0];
  let duck = null;
  for (const entry of lines) {
    const text = String(entry?.line ?? entry?.text ?? "").trim().replace(/\s+/g, " ");
    if (!text) continue;
    if (duck == null) {
      duck = entry?.duck != null ? duckIndex(entry.duck) : entry?.speaker != null ? duckIndex(entry.speaker) : 0;
      if (duck == null) duck = 0;
    } else {
      duck = duck === 0 ? 1 : 0;
    }
    if (counts[duck] >= MAX_LINES_PER_DUCK) continue;
    counts[duck]++;
    out.push({ duck, text, emotion: normalizeEmotion(entry?.emotion) });
  }
  return out;
}

// ── API call ────────────────────────────────────────────────────────────
export async function generateDialogue(apiKey, { whiteName = "White", blueName = "Blue" } = {}) {
  const key = apiKey || resolveApiKey();
  if (!key) {
    throw new Error("No DeepSeek API key. Set one before starting a chat.");
  }
  const gate = canChat();
  if (!gate.ok) {
    throw new Error(gate.reason);
  }
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: buildSystem(whiteName, blueName) },
      { role: "user", content: USER_PROMPT },
    ],
    temperature: 0.9,
    max_tokens: 900,
    stream: false,
    // JSON mode (OpenAI-compatible). DeepSeek requires the word "json" to
    // appear in the prompt when this is set — buildSystem includes it.
    response_format: { type: "json_object" },
  };
  let res;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") {
      throw new Error("DeepSeek API timed out after 30s.");
    }
    throw new Error(`Could not reach DeepSeek API (${e?.message || e}).`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err?.error?.message || err?.message || "";
    } catch {
      /* ignore */
    }
    if (res.status === 402 || /insufficient balance|not enough balance|balance is empty/i.test(detail)) {
      throw new Error(
        "DeepSeek balance is empty. DeepSeek is prepaid, so it never goes negative or bills beyond your balance — top up to keep chatting.",
      );
    }
    throw new Error(`DeepSeek API error ${res.status}${detail ? `: ${detail}` : ""}.`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  recordUsage(data?.usage?.total_tokens ?? estimateTokens(body, content));
  const parsed = extractJson(content);
  const lines = normalizeDialogue(parsed);
  if (!lines.length) {
    throw new Error("DeepSeek returned no usable dialogue.");
  }
  return lines;
}
