import {clipIds} from "../game/recordings.js";
// Chrome reads as small comic PANELS: each group sits in a thick cream
// keyline frame on a dark glass plate (1px ink inset between glass and
// frame), with a caption box (cartouche) overlapping the frame's corner -
// flat cream (orange for the shop CTA) fill, ink keyline, hard 2px offset
// shadow, half in / half out like a caption on a comic panel's edge. Same
// tokens as the landing (Anton, orange, cream), zero radius everywhere.
// Title-menu CTAs stay ComicButton.
//
// Whole HUD is hidden while the title/pause overlay is up; touch mode
// strips it down to the thumbs + Back.
import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import { keyframes } from "@mui/material/styles";
import { useGame, gameApi } from "../store.js";
import { VARIANT_LABELS, VARIANT_SWATCH_HEX } from "../game/variants.js";
import { uiClick, isMuted, setMuted } from "../game/audio.js";
import { getConfig, canChat } from "../game/deepseek.js";
import { stopVoice, playVoice, stopAutomaticVoice, voiceBusy } from "../game/voice.js";
import { ORANGE, MONO } from "../theme.js";
import { ANTON, COMIC_INK, CREAM } from "./comic.jsx";

const recBlink = keyframes`
  0%, 58% { opacity: 1; }
  59%, 100% { opacity: 0.12; }
`;

const chipPop = keyframes`
  0% { transform: scale(0.86); }
  55% { transform: scale(1.1); }
  100% { transform: scale(1); }
`;

const HUD_H = 48;
const FRAME_W = 2; // cream keyline thickness
const PANEL_PAD = 5; // air between the frame and the printed content
// Height left for the cells inside frame + padding; colour swatches use it
// as their width too so they stay square.
const CELL_H = HUD_H - 2 * (FRAME_W + PANEL_PAD);
const CELL_GAP = 4; // gap between cells; the glass ground shows through
const FRAME = "rgba(250, 248, 242, 0.9)";
const GLASS = "rgba(8, 8, 12, 0.6)";

// The panel frame: a thick cream keyline (comic ink weight, HUD read)
// around a dark glass plate, with a 1px ink inset between frame and glass
// so it reads like a printed panel, and a few px of glass padding so the
// content has air inside the frame (the glass ground fills the padding).
// The inset is a pseudo-element so it draws over the cells (an inset
// box-shadow would be painted under them). Overflow clipping lives on the
// inner content wrapper, not the plate, so the caption box can hang over
// the frame's corner.
const plateSx = {
  position: "relative",
  display: "inline-flex",
  height: HUD_H,
  boxSizing: "border-box",
  border: `${FRAME_W}px solid ${FRAME}`,
  padding: `${PANEL_PAD}px`,
  borderRadius: 0,
  background: GLASS,
  "&::after": {
    content: '""',
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: 2,
    boxShadow: `inset 0 0 0 1px ${COMIC_INK}`,
  },
};

// Caption box (cartouche) printed over the panel's top corner, half in /
// half out - the landing's print language: flat fill, ink keyline, hard
// offset shadow, zero radius. Decorative only: no pointer events, no
// layout footprint (absolute over the frame).
const CAPTION_FILLS = { cream: CREAM, orange: ORANGE };
const captionBaseSx = {
  position: "absolute",
  top: -9,
  zIndex: 3,
  pointerEvents: "none",
  userSelect: "none",
  whiteSpace: "nowrap",
  fontFamily: ANTON,
  fontSize: "0.58rem",
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  lineHeight: 1,
  padding: "3px 6px 2px",
  color: COMIC_INK,
  border: `2px solid ${COMIC_INK}`,
  borderRadius: 0,
  boxShadow: `2px 2px 0 ${COMIC_INK}`,
};

function HudPlate({ caption, captionSide = "left", captionFill = "cream", children, sx }) {
  return (
    <Box sx={{ ...plateSx, ...sx }}>
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "stretch",
          height: "100%",
          overflow: "hidden",
        }}
      >
        {children}
      </Box>
      {caption ? (
        <Box
          aria-hidden
          sx={{
            ...captionBaseSx,
            background: CAPTION_FILLS[captionFill],
            ...(captionSide === "right" ? { right: -8 } : { left: -8 }),
          }}
        >
          {caption}
        </Box>
      ) : null}
    </Box>
  );
}

// Speaker icon in the same square-stroke language as the back arrow:
// body + cone always, waves when live, a hard ink cross when muted.
function SpeakerIcon({ muted }) {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="square"
      strokeLinejoin="miter"
      sx={{ width: "1.05em", height: "1.05em", display: "block", flex: "none" }}
    >
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      {muted ? (
        <path d="M16 9l6 6M22 9l-6 6" />
      ) : (
        <>
          <path d="M16 9.5a3.5 3.5 0 0 1 0 5" />
          <path d="M18.5 7a7 7 0 0 1 0 10" />
        </>
      )}
    </Box>
  );
}

function BackArrowIcon() {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="square"
      strokeLinejoin="miter"
      sx={{ width: "0.95em", height: "0.95em", display: "block", flex: "none" }}
    >
      <path d="M20 12H6" />
      <path d="M12 5l-7 7 7 7" />
    </Box>
  );
}

const hudHitSx = {
  appearance: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.45em",
  height: "100%",
  px: "0.95rem",
  margin: 0,
  border: "none",
  borderRadius: 0,
  background: "transparent",
  color: CREAM,
  cursor: "pointer",
  fontFamily: ANTON,
  fontSize: "0.92rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  textDecoration: "none",
  lineHeight: 1,
  whiteSpace: "nowrap",
  WebkitTapHighlightColor: "transparent",
  userSelect: "none",
  transition: "background 0.15s ease, color 0.15s ease, filter 0.15s ease",
  "&:focus-visible": {
    outline: `2px dashed ${CREAM}`,
    outlineOffset: -5,
  },
};

function BackButton() {
  return (
    <HudPlate
      caption="Nav"
      sx={{ position: "fixed", top: "1.25rem", left: "1.5rem", zIndex: 10 }}
    >
      <Box
        component="button"
        type="button"
        onClick={() => { uiClick(); useGame.setState({ menuOpen: true }); }}
        sx={{
          ...hudHitSx,
          "&:hover": {
            color: ORANGE,
            background: "rgba(255, 122, 47, 0.12)",
          },
          "&:active": { filter: "brightness(0.92)" },
        }}
      >
        <BackArrowIcon /> Back
      </Box>
    </HudPlate>
  );
}

const emotions = ["curious", "excited", "laugh", "angry", "sad", "devastated", "defiant",
  "impatient", "mmh", "mock", "yes", "yes_fast", "no"];
const songs = ["jingle_bells", "duck_strut", "wistful"];

function RandomExpressions({ enabled }) {
  const last = useRef(null);
  useEffect(() => {
    if (!enabled) return;
    let timer;
    function schedule() {
      clearTimeout(timer);
      if (!document.hidden) {
        timer = setTimeout(tick, 12000 + Math.random() * 13000);
      }
    }
    function tick() {
      if (!document.hidden && gameApi.canExpress?.() && !voiceBusy()) {
        const pool = emotions.filter(name => name !== last.current);
        const name = pool[Math.floor(Math.random() * pool.length)];
        last.current = name;
        playVoice(name, undefined, true).catch(() => {});
      }
      schedule();
    }
    function visibilityChanged() {
      if (document.hidden) stopAutomaticVoice();
      schedule();
    }
    schedule();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      clearTimeout(timer);
      stopAutomaticVoice();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [enabled]);
  return null;
}

function VoicePanel({ random, toggleRandom }) {
  const [selected, select] = useState("curious");
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => stopVoice, []);
  useEffect(() => useGame.subscribe(s => s.stopCount, () => setPlaying(false)), []);
  const stop = () => { stopVoice(); setPlaying(false); };
  async function play() {
    setError("");
    setPlaying(true);
    try { await playVoice(selected, () => setPlaying(false)); }
    catch { setPlaying(false); setError("Audio could not play. Try again."); }
  }
  return (
    <HudPlate caption="Voice">
      <select aria-label="Emotion or song" value={selected}
        onChange={(e) => { stop(); select(e.target.value); setError(""); }}
        onKeyDown={(e) => e.stopPropagation()}>
        {[["Emotions", emotions], ["Songs", songs]].map(([label, names]) =>
          <optgroup key={label} label={label}>{names.map(name =>
            <option key={name} value={name}>{name.replaceAll("_", " ").replace(/^./, c => c.toUpperCase())}</option>
          )}</optgroup>)}
      </select>
      <Box component="button" type="button" sx={{ ...hudHitSx, px: 1, color: CREAM }}
        onKeyDown={(e) => e.stopPropagation()} onClick={playing ? stop : play}>
        {playing ? "Stop" : "Play"}
      </Box>
      <Box component="label" sx={{ display: "inline-flex", alignItems: "center", color: CREAM, px: 1, cursor: "pointer" }}>
        <input type="checkbox" checked={random} onChange={toggleRandom} aria-label="Random emotions"
          onKeyDown={e => e.stopPropagation()} /> Auto
      </Box>
      {error && <span role="alert">{error}</span>}
    </HudPlate>
  );
}

// "Talk": two ducks waddle together and chat via the DeepSeek API. The API
// key is set in the title screen's Settings (stored locally only, never in
// the repo); a press with no key points there. While a chat runs the
// button reads "Stop chat".
function TalkControl() {
  const conv = useGame((s) => s.conversation);
  const active = conv?.status === "approach" || conv?.status === "speak";

  const fail = (error) =>
    useGame.setState({
      conversation: { status: "error", speaker: -1, text: "", error },
    });

  const onClick = async () => {
    uiClick();
    if (active) {
      gameApi.stopConversation?.();
      return;
    }
    let cfg;
    try {
      cfg = await getConfig();
    } catch {
      fail("Local chat server not reachable. Start MicroDuck first.");
      return;
    }
    if (cfg.provider === "deepseek" && !cfg.hasKey) {
      fail("Chat isn't set up yet — open Settings (Esc) and save a DeepSeek key, or pick a local model.");
      return;
    }
    const gate = canChat();
    if (!gate.ok) {
      fail(gate.reason);
      return;
    }
    gameApi.startConversation?.();
  };

  return (
    <Box
      component="button"
      type="button"
      aria-pressed={active}
      title="Two ducks meet and chat (DeepSeek)"
      onClick={onClick}
      sx={{
        ...hudHitSx,
        px: 1,
        color: active ? ORANGE : CREAM,
        borderLeft: `1px solid rgba(250, 248, 242, 0.18)`,
      }}
    >
      {active ? "Stop chat" : "Talk"}
    </Box>
  );
}

// Toast for a failed conversation (bad key, network, no dialogue).
function ConversationToast() {
  const conv = useGame((s) => s.conversation);
  const err = conv?.status === "error" ? conv.error : "";
  useEffect(() => {
    if (!err) return;
    const t = setTimeout(() => {
      if (useGame.getState().conversation?.status === "error") {
        useGame.setState({ conversation: null });
      }
    }, 9000);
    return () => clearTimeout(t);
  }, [err]);
  if (!err) return null;
  return (
    <Box
      role="alert"
      sx={{
        position: "fixed",
        top: "9.2rem",
        right: "1.5rem",
        zIndex: 10,
        maxWidth: "24rem",
        fontFamily: MONO,
        fontSize: "0.66rem",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        textAlign: "right",
        lineHeight: 1.7,
        color: "#ff4b3a",
        textShadow: "0 0 8px rgba(255, 75, 58, 0.45)",
      }}
    >
      {`CHAT FAILED · ${err}`}
    </Box>
  );
}

function Quickbar({ random, toggleRandom }) {
  const variant = useGame((s) => s.variant);
  const locoWant = useGame((s) => s.locoWant);
  return (
    <Box
      sx={{
        position: "fixed",
        bottom: "1.25rem",
        left: "1.5rem",
        zIndex: 10,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-end",
        gap: "0.85rem",
        maxWidth: "calc(100vw - 14.5rem)",
      }}
    >
      <HudPlate caption="Color">
        <Box
          role="group"
          aria-label="Duck colours"
          sx={{
            display: "inline-flex",
            alignItems: "stretch",
            height: "100%",
            gap: `${CELL_GAP}px`,
          }}
        >
          {Object.entries(VARIANT_SWATCH_HEX).map(([name, hex]) => {
            const selected = name === variant;
            const label = VARIANT_LABELS[name] ?? name;
            return (
              <Box
                key={name}
                component="button"
                type="button"
                title={label}
                aria-label={`${label} colours`}
                aria-pressed={selected}
                onClick={() => { uiClick(); gameApi.setVariant?.(name); }}
                sx={{
                  appearance: "none",
                  width: CELL_H, // square cell inside frame + padding
                  height: "100%",
                  p: 0,
                  background: hex,
                  border: "none",
                  borderRadius: 0,
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                  boxShadow: selected ? `inset 0 0 0 2px ${CREAM}` : "none",
                  opacity: selected ? 1 : 0.7,
                  animation: selected ? `${chipPop} 0.28s ease` : "none",
                  transition: "opacity 0.15s ease, box-shadow 0.15s ease",
                  "&:hover": { opacity: 1 },
                  "&:active": { animation: "none", filter: "brightness(0.92)" },
                  "&:focus-visible": {
                    outline: `2px dashed ${CREAM}`,
                    outlineOffset: -5,
                  },
                  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                }}
              />
            );
          })}
        </Box>
      </HudPlate>
      <HudPlate caption="Mode">
        <Box
          role="group"
          aria-label="Locomotion mode"
          sx={{
            display: "inline-flex",
            alignItems: "stretch",
            height: "100%",
            gap: `${CELL_GAP}px`,
          }}
        >
          {[
            { name: "legs", label: "Feet" },
            { name: "rollers", label: "Rollers" },
          ].map(({ name, label }) => {
            const selected = locoWant === name;
            return (
              <Box
                key={name}
                component="button"
                type="button"
                aria-pressed={selected}
                onClick={() => { uiClick(); gameApi.requestLoco?.(name); }}
                sx={{
                  ...hudHitSx,
                  px: "1.05rem",
                  background: selected ? ORANGE : "transparent",
                  color: selected ? COMIC_INK : "rgba(250, 248, 242, 0.72)",
                  "&:hover": {
                    color: selected ? COMIC_INK : CREAM,
                    background: selected ? ORANGE : "rgba(255, 122, 47, 0.12)",
                  },
                  "&:active": { filter: "brightness(0.92)" },
                }}
              >
                {label}
              </Box>
            );
          })}
        </Box>
      </HudPlate>
      <VoicePanel random={random} toggleRandom={toggleRandom} />
      <PolicyChip />
      {/* Sound is fully disabled for now (SOUND_DISABLED in audio.js) -
          the mute toggle comes back with the finished sound design. */}
      {/* <SoundToggle /> */}
    </Box>
  );
}

// Active community move chip: rides the quickbar row in the same panel
// language. "PLAYING: <prompt or name> by <owner>" (Academy moves carry
// their prompt and author in manifest.academy), a hint on the key that
// plays a trick / script, and an X that swaps the official slot back in
// (gameApi.clearCustomPolicy).
function PolicyChip() {
  const cp = useGame((s) => s.customPolicy);
  if (cp?.status !== "active") return null;
  const title = cp.title || cp.name;
  const by = cp.author ? ` by ${cp.author}` : "";
  const hint = cp.slot === "trick" || cp.slot === "script" || cp.slot === "sitstand" ? " \u00b7 R" : "";
  return (
    <HudPlate caption="Playing" captionFill="orange">
      <Box sx={{ display: "inline-flex", alignItems: "stretch", height: "100%" }}>
        <Box
          sx={{
            ...hudHitSx,
            px: "0.85rem",
            cursor: "default",
            color: ORANGE,
            maxWidth: "22rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "inline-block",
            lineHeight: `${CELL_H}px`,
          }}
          title={`${cp.ref}${cp.kind ? ` (${cp.kind})` : ""}`}
        >
          {`${title}${by}${hint}`}
        </Box>
        <Box
          component="button"
          type="button"
          aria-label={`Unload move ${cp.name}`}
          onClick={() => { uiClick(); gameApi.clearCustomPolicy?.(); }}
          sx={{
            ...hudHitSx,
            px: "0.6rem",
            color: "rgba(250, 248, 242, 0.72)",
            "&:hover": {
              color: ORANGE,
              background: "rgba(255, 122, 47, 0.12)",
            },
            "&:active": { filter: "brightness(0.92)" },
          }}
        >
          {"\u2715"}
        </Box>
      </Box>
    </HudPlate>
  );
}

// Mute / unmute panel: same cartouche language as the other groups. The
// toggle ramps audio.js's master gain (~50 ms) and persists; unmuting
// plays the HUD click as confirmation (muting stays silent, obviously).
function SoundToggle() {
  const [muted, setMutedState] = useState(isMuted);
  const toggle = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (!next) uiClick();
  };
  return (
    <HudPlate caption="Sound">
      <Box
        component="button"
        type="button"
        aria-label={muted ? "Unmute sound" : "Mute sound"}
        aria-pressed={muted}
        onClick={toggle}
        sx={{
          ...hudHitSx,
          px: "0.75rem",
          color: muted ? "rgba(250, 248, 242, 0.5)" : CREAM,
          "&:hover": {
            color: muted ? CREAM : ORANGE,
            background: "rgba(255, 122, 47, 0.12)",
          },
          "&:active": { filter: "brightness(0.92)" },
        }}
      >
        <SpeakerIcon muted={muted} />
      </Box>
    </HudPlate>
  );
}

function Telemetry() {
  const t = useGame((s) => s.telemetry);
  const odo = t.odo < 1000 ? `${t.odo.toFixed(1)}M` : `${(t.odo / 1000).toFixed(2)}KM`;
  const lines = [];
  if (t.peers) lines.push(`${t.peers + 1} ONLINE`);
  lines.push(`${t.speed.toFixed(2)}M/S \u00b7 ODO ${odo}`);
  lines.push(`FPS ${t.fps} \u00b7 CTRL ${t.ctrlHz}HZ`);
  return (
    <Box
      sx={{
        position: "fixed",
        bottom: "1.25rem",
        right: "1.5rem",
        zIndex: 10,
        pointerEvents: "none",
        fontFamily: MONO,
        fontSize: "0.62rem",
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "rgba(255, 255, 255, 0.35)",
        fontVariantNumeric: "tabular-nums",
        textShadow: "0 0 6px rgba(255, 255, 255, 0.15)",
        whiteSpace: "pre-line",
        textAlign: "right",
        lineHeight: 1.8,
      }}
    >
      {lines.join("\n")}
    </Box>
  );
}

function OsdLoad() {
  const rollersLoading = useGame((s) => s.rollersLoading);
  const policyLoading = useGame((s) => s.customPolicy?.status === "loading");
  const lines = [];
  if (rollersLoading) lines.push("LOADING ROLLERS");
  if (policyLoading) lines.push("LOADING MOVE");
  if (!lines.length) return null;
  return (
    <Box
      sx={{
        position: "fixed",
        top: "5.2rem",
        right: "1.5rem",
        zIndex: 10,
        fontFamily: MONO,
        fontSize: "0.68rem",
        letterSpacing: "0.14em",
        color: ORANGE,
        textShadow: "0 0 8px rgba(255, 122, 47, 0.4)",
        textAlign: "right",
        lineHeight: 1.9,
      }}
    >
      {lines.map((l) => (
        <Box key={l}>
          {l}
          <Box
            component="span"
            sx={{ display: "inline-block", ml: "0.15em", animation: `${recBlink} 0.8s steps(1) infinite` }}
          >
            {"\u2588"}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

// Toast-style OSD line for policy failures: a load error or a watchdog
// revert paints below the loading line for a few seconds, then clears the
// store slot (the official walker is already back by then).
function PolicyToast() {
  const cp = useGame((s) => s.customPolicy);
  const isError = cp?.status === "error";
  useEffect(() => {
    if (!isError) return;
    const t = setTimeout(() => {
      if (useGame.getState().customPolicy === cp) {
        useGame.setState({ customPolicy: null });
      }
    }, 9000);
    return () => clearTimeout(t);
  }, [cp, isError]);
  if (!isError) return null;
  const msg = cp.revertReason
    ? `MOVE REVERTED \u00b7 ${cp.revertReason}`
    : `MOVE LOAD FAILED \u00b7 ${cp.error ?? "unknown error"}`;
  return (
    <Box
      role="alert"
      sx={{
        position: "fixed",
        top: "7.4rem",
        right: "1.5rem",
        zIndex: 10,
        maxWidth: "24rem",
        fontFamily: MONO,
        fontSize: "0.66rem",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        textAlign: "right",
        lineHeight: 1.7,
        color: "#ff4b3a",
        textShadow: "0 0 8px rgba(255, 75, 58, 0.45)",
      }}
    >
      {msg}
    </Box>
  );
}

export function EnvironmentMenu() {
  const current=useGame(s=>s.environment || "free");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  return <label>Environment <select aria-label="Environment" value={current} disabled={busy}
    onChange={async e=>{setBusy(true);setError("");try{await gameApi.openEnvironment(e.target.value);}
      catch(e){setError(e.message);}finally{setBusy(false);}}}>
    <option value="free">Meadow</option><option value="rink">Winter rink</option>
    <option value="football">Roller football</option><option value="race">Straight sprint</option><option value="circuit">Circuit skate</option>
  </select>{error && <span role="alert">{error}</span>}</label>;
}
export function PlaybackMenu(){
  const [ids,setIds]=useState([]),[id,select]=useState("demo"),[error,fail]=useState("");
  const last=useGame(s=>s.lastClip);
  useEffect(()=>{clipIds().then(setIds).catch(e=>fail(e.message));},[last]);
  return <div><label>Recording <select value={id} onChange={e=>select(e.target.value)}>
    <option value="demo">Winter rink · demo</option>
    {ids.map(k=><option key={k} value={k}>{new Date(k).toLocaleString()}</option>)}</select></label>
    <button onClick={()=>gameApi.watchClip(id).catch(e=>fail(e.message))}>Watch replay</button>
    <small style={{display:"block"}}>Camera · C change view · drag to orbit · 1 / 2 follow · 0 free</small>{error}</div>;
}

function SportsHud(){
  const environment=useGame(s=>s.environment),score=useGame(s=>s.score),manual=useGame(s=>s.manual);
  const countdown=useGame(s=>s.countdown),times=useGame(s=>s.times),finished=useGame(s=>s.finished);
  const status=useGame(s=>s.sportStatus),winner=useGame(s=>s.winner);
  const laps=useGame(s=>s.laps),metres=useGame(s=>s.metres);
  const football=environment==="football",circuit=environment==="circuit";
  return <Box sx={{position:"fixed",top:"1rem",left:"50%",transform:"translateX(-50%)",zIndex:12}}>
    <HudPlate caption={football?"Football · first to 3":circuit?"Circuit skate":"Straight sprint"}>
    {football?<><strong>White {score[0]} — {score[1]} Blue</strong>
      <label><input type="checkbox" checked={!!manual} onChange={e=>useGame.setState({manual:e.target.checked})}/> Play as White</label>
      {winner && <button onClick={()=>gameApi.openEnvironment("football")}>New match</button>}
    </>:<><strong>{countdown || "GO"}</strong>{times.map((t,i)=><span key={i}>{i?"Blue":"White"} {circuit?
      `${laps[i]} laps · ${metres[i].toFixed(1)} m`:`${t.toFixed(2)} s ${finished[i]?"✓":""}`}</span>)}
      <button onClick={()=>gameApi.openEnvironment(environment)}>Race again</button></>}
    {status && <strong role="status">{status}</strong>}
    </HudPlate></Box>;
}

export default function Hud() {
  const random = useGame(s => s.autoEmotions);
  const mood = useGame(s => s.mood);
  const recover = useGame(s => s.recoverInPlace);
  const quiet = useGame(s => !!s.stayQuiet);
  const activity = useGame(s => s.wanderActivity);
  const toggleRandom = () => {
    useGame.setState({ autoEmotions: !(random && !quiet), stayQuiet: false });
  };
  const entered = useGame((s) => s.entered);
  const menuOpen = useGame((s) => s.menuOpen);
  const touchMode = useGame((s) => s.touchMode);
  const watching=useGame(s=>s.watching),recording=useGame(s=>s.recording);
  const [saveError,setSaveError]=useState("");
  const cameraMode=useGame(s=>s.cameraMode||"Behind");
  const sport=useGame(s=>["race","football","circuit"].includes(s.environment));
  if(watching)return <button style={{position:"fixed",left:20,top:20,zIndex:40}} onClick={()=>gameApi.leaveReplay()}>← Back</button>;
  if (!entered || menuOpen) return null;
  return (
    <>
      <RandomExpressions enabled={random && !quiet && !sport} />
      <BackButton />
      <Box sx={{position:"fixed",left:"1.5rem",top:"5rem",zIndex:11}}><HudPlate caption="Scene"><EnvironmentMenu /><button title="Cycle camera (C)" onClick={()=>gameApi.cycleCamera()}>Camera · {cameraMode} (C)</button><button onClick={()=>recording?gameApi.finishRecording().catch(e=>setSaveError(e.message)):gameApi.startRecording()}>{recording?"Save recording":"Record"}</button>{saveError}</HudPlate></Box>
      {sport ? <SportsHud/> : (
      <Box sx={{ position: "fixed", top: "1.25rem", left: "50%", transform: "translateX(-50%)", zIndex: 11 }}>
        <HudPlate caption={mood || activity || "Free play"}>
          <Box component="button" type="button" aria-pressed={!!activity}
            onClick={() => gameApi.startWander?.()} sx={{ ...hudHitSx, px: 1, color: activity ? ORANGE : CREAM }}>Wander</Box>
          <Box component="button" type="button" aria-label="Stop wandering and stay"
            onClick={() => gameApi.stopWander?.()} sx={{ ...hudHitSx, px: 1, color: quiet ? ORANGE : CREAM }}>Stop</Box>
          <Box component="label" title="Stand up where the duck falls and continue playing"
            sx={{ display: "inline-flex", alignItems: "center", color: CREAM, px: 1, cursor: "pointer" }}>
            <input type="checkbox" checked={recover} onKeyDown={e => e.stopPropagation()}
              onChange={e => useGame.setState({ recoverInPlace: e.target.checked })} /> Get up
          </Box>
          <TalkControl />
        </HudPlate>
      </Box>
      )}
      {!touchMode && (
        <>
          <Quickbar random={random && !quiet} toggleRandom={toggleRandom} />
          <Telemetry />
          <OsdLoad />
          <PolicyToast />
          <ConversationToast />
        </>
      )}
    </>
  );
}
