import frames from "./voice-frames.json";
let player = null;
let timeline = null;
let automatic = false;

export const currentVoice = () =>
  player && !player.paused ? [player.dataset.clip, player.currentTime] : null;
export const voiceBusy = () => player !== null;

export function playReaction(name) {
  if (player && !automatic) return;
  playVoice(name, undefined, true).catch(() => {});
}

export function stopAutomaticVoice() {
  if (automatic) stopVoice();
}

export function fadeOut(previous) {
  if (previous.paused || previous.ended) {
    previous.pause();
  } else {
    const start = performance.now();
    const volume = previous.volume;
    const fade = setInterval(() => {
      const remaining = Math.max(0, 1 - (performance.now() - start) / 24);
      previous.volume = volume * remaining;
      if (remaining === 0) {
        clearInterval(fade);
        previous.pause();
      }
    }, 4);
  }
}

export function stopVoice() {
  if (player) {
    const previous = player;
    previous.onended = null;
    fadeOut(previous);
    player = null;
    automatic = false;
  }
}

export async function playVoice(
  name,
  onEnd = () => {},
  isAutomatic = false,
  offset = 0,
  rate = 1,
) {
  stopVoice();
  const audio = new Audio(`./duck-voice/${name}.wav?v=clean1`);
  audio.dataset.clip = name;
  if (rate && rate !== 1) audio.playbackRate = rate; // vary pitch/tempo
  if (offset > 0) audio.currentTime = offset;
  player = audio;
  automatic = isAutomatic;
  timeline = frames[name];
  audio.onended = () => {
    stopVoice();
    onEnd();
  };
  try {
    await audio.play();
  } catch (error) {
    if (player === audio) {
      stopVoice();
      throw error;
    }
  }
}

export function voiceFrame() {
  if (!player || player.paused) return null;
  return timeline[
    Math.min(timeline.length - 1, Math.floor(player.currentTime * 25))
  ];
}
