// Chat integration for the duck-duck conversation feature.
//
// The app talks to a small LOCAL server (server.py, served from the same
// origin) that holds the provider choice and the DeepSeek API key in a file
// on this computer (~/.microduck/config.json) — never in the browser and
// never in the repo — and proxies the request to either the DeepSeek API or
// a local model (Ollama / LM Studio). The browser never sees the key.
//
// generateDialogue() asks the model for a short, alternating, EMOTIONAL
// Russian chat, seeded with a random situation/topic so the dialogue is
// lively and varied rather than a fixed greet-chat-goodbye template. The
// reply is normalized into `[{duck:0|1, text, emotion}]` with a hard
// per-duck line cap.

// ── Spend guard: prepaid + client-side caps ──────────────────────────────
// DeepSeek is a PREPAID API: it cannot go negative or accrue debt — once a
// balance is empty the API answers 402 "Insufficient Balance". On top of
// that, the app enforces a daily token budget and a cooldown between chats
// (persisted in this browser as a soft guard).
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

// ── Local server config (provider + key live on this PC, not here) ───────
export async function getConfig() {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error("Local chat server not reachable.");
  return res.json();
}

export async function saveConfig(patch) {
  const res = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch || {}),
  });
  if (!res.ok) throw new Error("Could not save settings.");
  return res.json();
}

// ── Dialogue rules ───────────────────────────────────────────────────────
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

// Random, concrete situations so every chat starts somewhere specific and
// funny instead of a generic "hi, how are you".
const SCENARIOS = [
  "они спорят, кто быстрее доплывёт до кормушки, и подкалывают друг друга",
  "одна утка только что смешно шлёпнулась на льду и смущается, вторая подбадривает и не может не хихикать",
  "они ищут пропавший мячик и строят заговор против белки, которая его утащила",
  "они планируют вечеринку у пруда и спорят о закусках и музыке",
  "одна рассказывает нелепый сон про летающих рыб, вторая не верит и передразнивает",
  "они хвастаются трюками и дразнят друг друга, кто круче",
  "они жалуются на дождь и придумывают, чем заняться, чтобы не скучать",
  "одна нашла блестящую монетку и не хочет делиться, вторая пытается её уболтать",
  "они вспоминают вчерашний футбольный матч и спорят, чей гол был красивее",
  "одна утка решила, что она теперь супергерой, и вторая подыгрывает, но с сарказмом",
  "они обсуждают, что бы загадать, если найдётся золотая рыбка",
  "одна учит вторую новому танцу, и у второй ничего не выходит",
];

function buildSystem(whiteName, blueName, scenario) {
  return [
    `You are writing the dialogue for two rubber-duck robots in a toy simulator.`,
    `One duck is "${whiteName}" and the other is "${blueName}".`,
    `Situation right now: ${scenario}. Start INSIDE this scene - no greetings, no`,
    `"привет" and no introductions; jump straight into the middle of the conversation.`,
    `Write every line of dialogue in Russian (Cyrillic).`,
    `Make it lively, funny and natural: short spoken lines (roughly 2 to 14 words),`,
    `personality, teasing, interjections (ой, ну, ага, эй), surprises, and real emotion.`,
    `Do NOT follow a greeting -> small talk -> goodbye template. Vary who leads,`,
    `and end the chat the moment it feels finished - a goodbye is optional.`,
    `Strictly alternate speakers.`,
    `Each duck speaks at most ${TARGET_LINES_PER_DUCK} lines. If one more line is needed to`,
    `finish cleanly, you may go up to ${MAX_LINES_PER_DUCK} lines per duck, but never more.`,
    `Each line also carries an "emotion" - the duck's feeling for that line - chosen from`,
    `exactly this set: ${EMOTIONS.join(", ")}. Vary the emotions to match the flow.`,
    `Respond with ONLY a JSON object, no commentary, in exactly this shape:`,
    `{"lines":[{"duck":"white","line":"...","emotion":"happy"},{"duck":"blue","line":"...","emotion":"curious"}]}`,
    `"duck" is either "white" or "blue" and must alternate.`,
  ].join(" ");
}

const USER_PROMPT = "Две утки встретились на лугу. Напиши их короткий разговор на русском.";

// ── Response normalization ──────────────────────────────────────────────
function duckIndex(token) {
  const t = String(token ?? "").trim().toLowerCase();
  if (["white", "0", "a", "first", "left", "duck1"].includes(t)) return 0;
  if (["blue", "1", "b", "second", "right", "duck2"].includes(t)) return 1;
  return null;
}

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

// Normalize arbitrary model output into `[{duck:0|1, text, emotion}]`.
// Strict alternation is enforced and each duck is hard-capped.
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

// ── API call (through the local proxy) ─────────────────────────────────
export async function generateDialogue({ whiteName = "White", blueName = "Blue" } = {}) {
  const gate = canChat();
  if (!gate.ok) {
    throw new Error(gate.reason);
  }
  const scenario = SCENARIOS[(Math.random() * SCENARIOS.length) | 0];
  const body = {
    messages: [
      { role: "system", content: buildSystem(whiteName, blueName, scenario) },
      { role: "user", content: USER_PROMPT },
    ],
    temperature: 1.1,
    max_tokens: 900,
    stream: false,
    // JSON mode (OpenAI-compatible); the local proxy strips this for local
    // runtimes that reject it, and the tolerant parser below still works.
    response_format: { type: "json_object" },
  };
  let res;
  try {
    res = await fetch("/api/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`Could not reach the local chat server (${e?.message || e}). Start MicroDuck first.`);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err?.error?.message || err?.message || "";
    } catch {
      /* ignore */
    }
    if (/insufficient balance|balance is empty/i.test(detail)) {
      throw new Error(
        "DeepSeek balance is empty. DeepSeek is prepaid, so it never goes negative or bills beyond your balance — top up to keep chatting.",
      );
    }
    throw new Error(detail || `Chat error ${res.status}.`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  recordUsage(data?.usage?.total_tokens ?? estimateTokens(body, content));
  const parsed = extractJson(content);
  const lines = normalizeDialogue(parsed);
  if (!lines.length) {
    throw new Error("The model returned no usable dialogue. Try again.");
  }
  return lines;
}
