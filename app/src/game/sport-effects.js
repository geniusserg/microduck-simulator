import * as THREE from "three";
import frames from "./voice-frames.json";
import { fadeOut } from "./voice.js";

export function sportEffects(scene) {
  const labels = ["White", "Blue"].map((name, i) => {
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.font = "bold 40px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 8;
    ctx.lineJoin = "round";
    ctx.strokeStyle = i ? "#17395a" : "#343333";
    ctx.strokeText(name, 96, 32);
    ctx.fillStyle = i ? "#a8d6ff" : "#fffdf5";
    ctx.fillText(name, 96, 32);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map, depthWrite: false }),
    );
    label.scale.set(0.17, 0.057, 1);
    scene.add(label);
    return label;
  });
  const voices = [null, null];
  const sounds = {
    joy: ["excited", "laugh", "yes_fast"],
    duel: ["tackle", "snarl", "challenge", "rattle", "scramble"],
    breath: ["pant"],
    disappointed: ["sad"],
  };
  function stop(i) {
    const player = voices[i];
    if (player) {
      fadeOut(player);
      voices[i] = null;
    }
  }
  function play(i, name, offset = 0) {
    stop(i);
    const audio = new Audio(`./duck-voice/${name}.wav`);
    audio.volume = i ? 0.6 : 0.68;
    audio.dataset.name = name;
    audio.currentTime = offset;
    voices[i] = audio;
    audio.onended = () => {
      if (voices[i] === audio) voices[i] = null;
    };
    audio.play().catch(() => {
      if (voices[i] === audio) voices[i] = null;
    });
  }
  const count = 180,
    positions = new Float32Array(count * 3),
    colors = new Float32Array(count * 3);
  const particles = Array.from({ length: count }, (_, i) => {
    const burst = Math.floor(i / 45),
      a = i * 2.39996,
      z = 1 - (2 * ((i % 45) + 0.5)) / 45,
      r = Math.sqrt(1 - z * z);
    const color = new THREE.Color().setHSL(
      (burst * 0.23 + (i % 3) * 0.035) % 1,
      0.95,
      0.66,
    );
    color.toArray(colors, i * 3);
    return [r * Math.cos(a), z, r * Math.sin(a), burst];
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const stars = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 0.047,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    }),
  );
  stars.frustumCulled = false;
  stars.visible = false;
  scene.add(stars);
  function fireworks(state) {
    stars.visible = !!state && state[1] < 5;
    if (!stars.visible) return;
    const [winner, clock] = state;
    for (let i = 0; i < count; i++) {
      const [vx, vy, vz, g] = particles[i],
        t = (clock + 2 - g * 0.32) % 2;
      const extent = Math.sin(Math.PI * Math.min(t / 1.9, 1)) * 0.87;
      positions[i * 3] =
        (winner ? 1 : -1) * 1.1 + (g - 1.5) * 0.52 + vx * extent;
      positions[i * 3 + 1] =
        0.72 + g * 0.14 + Math.sin((t * Math.PI) / 2) * 0.55 + vy * extent;
      positions[i * 3 + 2] = -0.12 + vz * extent;
    }
    geo.attributes.position.needsUpdate = true;
  }
  return {
    fireworks,
    names(white, blue) {
      for (const [i, q] of [white, blue].entries())
        labels[i].position.set(q[0], q[2] + 0.235, -q[1]);
    },
    cue(kind, i) {
      const pool = sounds[kind];
      play(i, pool[Math.floor(Math.random() * pool.length)]);
    },
    neck(i) {
      const p = voices[i];
      if (!p || p.paused) return null;
      const seq = frames[p.dataset.name];
      if (seq)
        return seq[Math.min(seq.length - 1, Math.floor(p.currentTime * 25))];
      if (sounds.duel.includes(p.dataset.name))
        return [
          0.1,
          0.13 * Math.sin(p.currentTime * 23),
          0.18 * Math.sin(p.currentTime * 16),
          0,
        ];
      return null;
    },
    jaw(i) {
      const p = voices[i];
      return p && !p.paused ? 0.3 + 0.28 * Math.sin(p.currentTime * 20) : 0;
    },
    stopVoices() {
      stop(0);
      stop(1);
    },
    snapshot() {
      return voices.map((p) =>
        p && !p.paused ? [p.dataset.name, p.currentTime] : null,
      );
    },
    restore(frame) {
      for (let i = 0; i < 2; i++) {
        const target = frame?.[i];
        if (!target) stop(i);
        else if (
          voices[i]?.dataset.name !== target[0] ||
          Math.abs(voices[i].currentTime - target[1]) > 0.28
        )
          play(i, ...target);
      }
    },
    clear() {
      stop(0);
      stop(1);
      stars.visible = false;
    },
  };
}
