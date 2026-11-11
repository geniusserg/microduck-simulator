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

// Curated Russian fallback dialogues, used only if the model ever returns
// something unparsable — so the ducks ALWAYS have something to say and the
// "no usable dialogue" failure can never surface.
const FALLBACK_DIALOGUES = [
  [
    { duck: 0, text: "Ну что, кто первый до кормушки?", emotion: "excited" },
    { duck: 1, text: "Опять соревноваться? Я только поел!", emotion: "surprised" },
    { duck: 0, text: "Так это разминка перед обедом. Погнали!", emotion: "happy" },
    { duck: 1, text: "Ладно, но без подножек на повороте.", emotion: "angry" },
    { duck: 0, text: "Кто? Я? Да никогда в жизни!", emotion: "amused" },
    { duck: 1, text: "Вот и не делай так, как в прошлый раз!", emotion: "angry" },
    { duck: 0, text: "Это была стратегическая пауза в камышах!", emotion: "amused" },
    { duck: 1, text: "Стратег нашёлся. Ну, догоняй!", emotion: "excited" },
  ],
  [
    { duck: 0, text: "Ты видел, какая лужа после дождя? Огромная!", emotion: "excited" },
    { duck: 1, text: "Видел. Уже прикидываю, как в ней наплаваться.", emotion: "happy" },
    { duck: 0, text: "Только не утащи туда мой мячик, как в тот раз.", emotion: "angry" },
    { duck: 1, text: "Он сам туда закатился, честное кря!", emotion: "surprised" },
    { duck: 0, text: "Ага, а лапки у него, конечно, были.", emotion: "amused" },
    { duck: 1, text: "Ну всё, пошли купаться, ворчун.", emotion: "happy" },
    { duck: 0, text: "Ладно. Но мячик держи подальше от воды!", emotion: "curious" },
  ],
  [
    { duck: 0, text: "Мне сегодня приснилось, что я летаю над прудом.", emotion: "surprised" },
    { duck: 1, text: "Утки не летают во сне, мы же... ну, почти.", emotion: "curious" },
    { duck: 0, text: "А я вот летал! И рыбы махали мне плавниками.", emotion: "excited" },
    { duck: 1, text: "Всё, тебе точно хватит есть перед сном.", emotion: "amused" },
    { duck: 0, text: "Ничего ты не понимаешь в больших мечтах!", emotion: "angry" },
    { duck: 1, text: "Ладно-ладно, мечтатель. Научишь и меня летать?", emotion: "happy" },
    { duck: 0, text: "Только если будешь слушаться капитана.", emotion: "amused" },
  ],
  [
    { duck: 0, text: "Я нашёл блестящую монетку у берега!", emotion: "excited" },
    { duck: 1, text: "Ух ты! Покажи! Это же целое сокровище.", emotion: "surprised" },
    { duck: 0, text: "Не покажу. Вдруг ты её утащишь.", emotion: "angry" },
    { duck: 1, text: "Да зачем она мне? Я просто полюбоваться хотел.", emotion: "sad" },
    { duck: 0, text: "Ладно... смотри, но только одним глазом.", emotion: "neutral" },
    { duck: 1, text: "Красота! А знаешь, ей место в нашем гнезде.", emotion: "happy" },
    { duck: 0, text: "Эй, я её первый нашёл!", emotion: "angry" },
    { duck: 1, text: "Нашёл — значит, теперь общая. Кряк!", emotion: "amused" },
  ],
  [
    { duck: 0, text: "Давай устроим вечеринку у пруда!", emotion: "excited" },
    { duck: 1, text: "А повод какой? Просто так вечеринок не бывает.", emotion: "curious" },
    { duck: 0, text: "Повод — мы сегодня ни разу не упали!", emotion: "happy" },
    { duck: 1, text: "Это рекорд. Стоит отметить, согласен.", emotion: "amused" },
    { duck: 0, text: "Я принесу хлебных крошек. Ты — хорошее настроение.", emotion: "happy" },
    { duck: 1, text: "А кто музыку крякать будет?", emotion: "curious" },
    { duck: 0, text: "Ты, конечно. У тебя самый звонкий кряк.", emotion: "amused" },
    { duck: 1, text: "Ну держись, я дам концерт!", emotion: "excited" },
  ],
];

function buildSystem(whiteName, blueName, scenario) {
  return [
    `You are writing the dialogue for two rubber-duck robots in a toy simulator.`,
    `One duck is "${whiteName}" and the other is "${blueName}". Always call them exactly`,
    `"${whiteName}" and "${blueName}" — never translate their names.`,
    `Situation right now: ${scenario}. Use it as a spark to start, but don't fixate on it —`,
    `keep the conversation flowing naturally and stay on one coherent topic. Start INSIDE`,
    `this scene - no greetings, no "привет" and no introductions.`,
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

// Extract the first JSON value (object or array) out of a possibly fenced /
// prefixed reply.
export function extractJson(text) {
  const s = String(text ?? "");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : s;
  const brace = candidate.indexOf("{");
  const bracket = candidate.indexOf("[");
  let open = brace;
  if (brace < 0 || (bracket >= 0 && bracket < brace)) open = bracket;
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < candidate.length; i++) {
    const c = candidate[i];
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
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
    const text = String(entry?.line ?? entry?.text ?? entry?.content ?? entry?.message ?? "").trim().replace(/\s+/g, " ");
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

// Fallback parser: "White: …" / "Белый: …" lines, for when the model ignores
// the JSON instruction and just prints a script.
function parsePlainText(text) {
  const out = [];
  const counts = [0, 0];
  const re = /(white|blue|белый|белая|синий|синяя)\s*[:—–-]\s*([^\n]+)/gi;
  let m;
  while ((m = re.exec(String(text ?? ""))) !== null) {
    const duck = /white|белый|белая/i.test(m[1]) ? 0 : 1;
    const line = m[2].trim().replace(/\s+/g, " ");
    if (!line || counts[duck] >= MAX_LINES_PER_DUCK) continue;
    counts[duck]++;
    out.push({ duck, text: line, emotion: "neutral" });
  }
  return out;
}

// Try structured JSON first, then a plain script; null if neither works.
function parseDialogue(content) {
  const structured = normalizeDialogue(extractJson(content));
  if (structured.length) return structured;
  const plain = parsePlainText(content);
  if (plain.length) return plain;
  return null;
}

function pickFallback() {
  const d = FALLBACK_DIALOGUES[(Math.random() * FALLBACK_DIALOGUES.length) | 0];
  return d.map((l) => ({ ...l }));
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
    if (res.status === 401 || /authentication|invalid api key/i.test(detail)) {
      throw new Error("DeepSeek rejected the API key. Open Settings (Esc) and re-save it.");
    }
    throw new Error(detail || `Chat error ${res.status}.`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  recordUsage(data?.usage?.total_tokens ?? estimateTokens(body, content));
  const lines = parseDialogue(content);
  if (lines) return lines;
  // Never surface a "no dialogue" failure: fall back to a curated chat so
  // the ducks always have something to say.
  console.warn("[chat] unparsable content, using fallback dialogue:", content);
  return pickFallback();
}
