import * as T from "three";

const mat = (color) => new T.MeshStandardMaterial({ color, roughness: 0.8 });
function mesh(parent, geometry, material, x, y, z) {
  const m = new T.Mesh(geometry, material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function rng(seed) {
  return () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
}
function boughs() {
  const points = [],
    indices = [];
  const layers = [
    [0.98, 0.08],
    [1, 0.25],
    [0.8, 0.43],
    [0.48, 0.74],
    [0.04, 1],
  ];
  const n = 72;
  for (const [radius, height] of layers) {
    for (let j = 0; j <= n; j++) {
      const a = (j / n) * Math.PI * 2,
        tip = Math.cos(12 * a);
      const r = radius * (0.95 + 0.05 * tip);
      points.push(
        r * Math.cos(a),
        height - (1 - height) ** 2 * 0.1 * tip,
        r * Math.sin(a),
      );
      const i = points.length / 3 - 1;
      if (j && i > n)
        indices.push(i - n - 2, i - 1, i, i - n - 2, i, i - n - 1);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(points, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
function stamped(parent, geometry, material, records) {
  const out = new T.InstancedMesh(geometry, material, records.length),
    obj = new T.Object3D();
  records.forEach(([x, y, z, sx, sy, sz, angle, color], i) => {
    obj.position.set(x, y, z);
    obj.rotation.y = angle;
    obj.scale.set(sx, sy, sz);
    obj.updateMatrix();
    out.setMatrixAt(i, obj.matrix);
    if (color !== undefined) out.setColorAt(i, new T.Color(color));
  });
  parent.add(out);
  return out;
}
function iceMap(random) {
  const c = document.createElement("canvas");
  c.width = c.height = 768;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(360, 365, 0, 380, 380, 565);
  g.addColorStop(0, "#abcfd8");
  g.addColorStop(0.7, "#a6cbd8");
  g.addColorStop(1, "#e0edf1");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 768, 768);
  for (let i = 0; i < 600; i++) {
    const a = random() * 6.28;
    ctx.strokeStyle = i % 3 ? "rgba(255,255,255,.28)" : "rgba(99,154,180,.16)";
    ctx.lineWidth = 0.4 + random() * 0.8;
    ctx.beginPath();
    ctx.ellipse(
      random() * 768,
      random() * 768,
      15 + random() * 170,
      8 + random() * 95,
      random() * 3,
      a,
      a + 0.07 + random() * 0.85,
    );
    ctx.stroke();
  }
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}
function starGeometry() {
  const s = new T.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5,
      r = i % 2 ? 0.031 : 0.069;
    if (i) s.lineTo(r * Math.cos(a), r * Math.sin(a));
    else s.moveTo(r * Math.cos(a), r * Math.sin(a));
  }
  s.closePath();
  return new T.ExtrudeGeometry(s, {
    depth: 0.01,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 1,
    steps: 1,
  });
}
export function createWinter(scene) {
  const group = new T.Group();
  group.name = "Christmas ice rink";
  group.visible = false;
  scene.add(group);
  const random = rng(20261225),
    white = mat(0xeef6ff),
    fir = boughs(),
    unit = new T.BoxGeometry(1, 1, 1);
  const snow = mesh(group, new T.PlaneGeometry(42, 42), white, 0, -0.004, 0);
  snow.rotation.x = -Math.PI / 2;
  const ice = mesh(
    group,
    new T.CircleGeometry(2.14, 100),
    new T.MeshStandardMaterial({
      map: iceMap(random),
      roughness: 0.24,
      metalness: 0.18,
      color: 0xffffff,
    }),
    0,
    0.0002,
    0,
  );
  ice.rotation.x = -Math.PI / 2;
  const forest = [],
    branches = [],
    caps = [],
    trunks = [];
  const tiers = [
    [0.13, 0.29, 0.34],
    [0.28, 0.25, 0.31],
    [0.41, 0.205, 0.28],
    [0.53, 0.154, 0.24],
    [0.63, 0.102, 0.22],
  ];
  const addFir = (x, z, scale, records) => {
    trunks.push([
      x,
      0.1 * scale,
      z,
      0.045 * scale,
      0.2 * scale,
      0.045 * scale,
      0,
    ]);
    tiers.forEach(([h, r, length], i) => {
      const angle = i * 0.31;
      records.push([
        x,
        h * scale,
        z,
        r * scale,
        length * scale,
        r * scale,
        angle,
        [0x185344, 0x226446, 0x2b704f, 0x347955, 0x3d8159][i],
      ]);
      caps.push([
        x,
        (h + 0.34 * length) * scale,
        z,
        r * 0.8 * scale,
        0.68 * length * scale,
        r * 0.8 * scale,
        angle,
        0xccdfdf,
      ]);
    });
  };
  addFir(0, 0, 1, branches);

  const banks = [];
  for (let i = 0; i < 82; i++) {
    const a = random() * 6.28,
      r = 3 + random() * 7;
    addFir(Math.cos(a) * r, Math.sin(a) * r, 0.7 + random() * 1.7, forest);
  }
  for (let i = 0; i < 70; i++) {
    const a = i * 2.399,
      r = 2.12 + random() * 0.18;
    banks.push([
      r * Math.cos(a),
      -0.022,
      r * Math.sin(a),
      0.14 + random() * 0.13,
      0.055 + random() * 0.07,
      0.19,
      a,
    ]);
  }
  stamped(group, new T.IcosahedronGeometry(1, 1), white, banks);
  stamped(group, new T.CylinderGeometry(0.8, 1, 1, 10), mat(0x655344), trunks);
  stamped(group, fir, mat(0xffffff), branches.concat(forest));
  stamped(group, fir, mat(0xffffff), caps);

  const radiusAt = (y) =>
    Math.max(
      0.017,
      ...tiers.map(([h, r, l]) =>
        y >= h && y <= h + l
          ? r * (1 - Math.max(0, (y - h) / l - 0.18) / 0.86)
          : 0,
      ),
    );
  const wire = [],
    bulbs = [],
    ornaments = [],
    hooks = [];
  const bulbColors = [0xffc84d, 0xff705c, 0x63e2ce, 0xffa1d6];
  for (let i = 0; i <= 240; i++) {
    const t = i / 240,
      a = t * 6.4 * Math.PI + 0.6,
      y = 0.199 + 0.585 * t,
      r = radiusAt(y) + 0.013;
    const x = r * Math.cos(a),
      z = r * Math.sin(a);
    wire.push(new T.Vector3(x, y, z));
    if (i % 4 === 0)
      bulbs.push([
        x,
        y - 0.004,
        z,
        0.009,
        0.012,
        0.009,
        0,
        bulbColors[(i / 4) % 4],
      ]);
  }
  mesh(
    group,
    new T.TubeGeometry(new T.CatmullRomCurve3(wire), 240, 0.0025, 5, false),
    mat(0x87642a),
    0,
    0,
    0,
  );
  stamped(
    group,
    new T.SphereGeometry(1, 10, 8),
    new T.MeshBasicMaterial({ color: 0xffffff }),
    bulbs,
  );
  const haloGeometry = new T.BufferGeometry();
  haloGeometry.setAttribute(
    "position",
    new T.Float32BufferAttribute(
      bulbs.flatMap((b) => b.slice(0, 3)),
      3,
    ),
  );
  haloGeometry.setAttribute(
    "color",
    new T.Float32BufferAttribute(
      bulbs.flatMap((b) => new T.Color(b[7]).toArray()),
      3,
    ),
  );
  const halo = new T.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    vertexShader: `varying vec3 tint;uniform float time;
      void main(){vec4 p=modelViewMatrix*vec4(position,1.);
      tint=color*(.8+.2*sin(time*2.1+position.y*35.));
      gl_PointSize=clamp(29./(-p.z),4.,27.);gl_Position=projectionMatrix*p;}`,
    fragmentShader: `varying vec3 tint;void main(){float r=length(gl_PointCoord-.5)*2.;
      float alpha=pow(max(0.,1.-r),2.6);gl_FragColor=vec4(tint,alpha*.9);}`,
  });
  group.add(new T.Points(haloGeometry, halo));
  const globe = new T.SphereGeometry(1, 14, 10),
    gold = mat(0xe7b850);
  for (let i = 0; i < 40; i++) {
    const a = i * 2.399,
      y = 0.196 + 0.5 * ((i + 0.5) / 40),
      r = radiusAt(y) + 0.017,
      sz = 0.016 + random() * 0.01;
    const x = r * Math.cos(a),
      z = r * Math.sin(a);
    ornaments.push([
      x,
      y,
      z,
      sz,
      sz * 1.08,
      sz,
      a,
      [0xca2338, 0xdca334, 0x246c9c, 0xe85c42, 0x865ba5][i % 5],
    ]);
    hooks.push([x, y + sz, z, 0.004, 0.005, 0.004, 0]);
  }
  stamped(
    group,
    globe,
    new T.MeshStandardMaterial({ metalness: 0.5, roughness: 0.22 }),
    ornaments,
  );
  stamped(group, unit, gold, hooks);
  const star = mesh(
    group,
    starGeometry(),
    new T.MeshStandardMaterial({
      color: 0xffce42,
      emissive: 0xffa72b,
      emissiveIntensity: 0.48,
      metalness: 0.3,
      roughness: 0.32,
    }),
    0,
    0.88,
    0,
  );
  star.rotation.y = -0.7;
  const paper = [0xa92a45, 0x31877c, 0xe8c785, 0x3d628f, 0xbe4e32, 0x78547f];
  for (let i = 0; i < 10; i++) {
    const a = i * 2.399 + 0.4,
      r = 0.19 + (i % 3) * 0.045,
      w = 0.071 + random() * 0.05,
      h = 0.055 + random() * 0.062,
      d = w * 0.84;
    const box = new T.Group();
    box.position.set(r * Math.cos(a), 0, r * Math.sin(a));
    box.rotation.y = a * 0.7;
    group.add(box);
    const pack = mesh(box, unit, mat(paper[i % paper.length]), 0, h / 2, 0);
    pack.scale.set(w, h, d);
    const ribbon = i % 2 ? gold : mat(0xf7e7bc);
    mesh(box, unit, ribbon, 0, h / 2, 0).scale.set(
      w * 0.14,
      h + 0.002,
      d + 0.002,
    );
    mesh(box, unit, ribbon, 0, h / 2, 0).scale.set(
      w + 0.002,
      h + 0.003,
      d * 0.15,
    );
    for (const side of [-1, 1]) {
      const loop = mesh(
        box,
        new T.TorusGeometry(0.012, 0.003, 6, 16),
        ribbon,
        side * 0.009,
        h + 0.01,
        0,
      );
      loop.scale.set(1.2, 0.6, 1);
      loop.rotation.z = side * 0.42;
    }
  }
  const flakes = new Float32Array(650 * 3);
  for (let i = 0; i < flakes.length; i += 3) {
    flakes[i] = (random() - 0.5) * 6;
    flakes[i + 1] = random() * 2.6;
    flakes[i + 2] = (random() - 0.5) * 6;
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.BufferAttribute(flakes, 3));
  const dust = new T.Points(
    g,
    new T.PointsMaterial({
      color: 0xffffff,
      size: 0.009,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    }),
  );
  group.add(dust);
  function update(dt) {
    if (!group.visible) return;
    halo.uniforms.time.value += dt;
    for (let i = 1; i < flakes.length; i += 3) {
      flakes[i] -= dt * (0.055 + 0.012 * (i % 8));
      if (flakes[i] < 0) flakes[i] += 2.6;
    }
    g.attributes.position.needsUpdate = true;
  }
  return { group, update };
}

// Steel runners sit where the four wheel contact patches meet the floor.
// Their local coordinate system matches the roller ankle frame on each side.
const skateSets = new WeakMap();
export function showBlades(rig, enabled) {
  if (!rig.bodies.has("ankle_l_v1")) return;
  if (!skateSets.has(rig)) {
    if (!enabled) return;
    const wheels = [],
      blades = [];
    rig.root.traverse((o) => {
      if (
        o.isMesh &&
        ["rim.stl", "tire.stl", "roller_blade.stl"].includes(
          o.userData.meshName,
        )
      )
        wheels.push(o);
    });
    const steel = new T.MeshStandardMaterial({
        color: 0xc4e6fb,
        metalness: 0.7,
        roughness: 0.22,
      }),
      boot = mat(0x963347);
    for (const name of ["ankle_l_v1", "ankle_r_v1"]) {
      const foot = rig.bodies.get(name),
        g = new T.Group();
      g.name = "Ice skate";
      foot.add(g);
      blades.push(g);
      const hubs = foot.children.filter((o) => o.name.startsWith("tire"));
      const cx = (hubs[0].position.x + hubs[1].position.x) / 2,
        cz = hubs[0].position.z;
      const shape = new T.Shape();
      shape.moveTo(-0.056, -0.032);
      shape.quadraticCurveTo(-0.048, -0.049, -0.032, -0.049);
      shape.lineTo(0.036, -0.049);
      shape.quadraticCurveTo(0.054, -0.046, 0.057, -0.033);
      shape.quadraticCurveTo(0.045, -0.043, 0.034, -0.044);
      shape.lineTo(-0.034, -0.044);
      shape.closePath();
      mesh(
        g,
        new T.ExtrudeGeometry(shape, { depth: 0.003, bevelEnabled: false }),
        steel,
        cx,
        0,
        cz - 0.0015,
      );
      for (const x of [-0.026, 0.026])
        mesh(
          g,
          new T.BoxGeometry(0.007, 0.018, 0.004),
          steel,
          cx + x,
          -0.037,
          cz,
        );
      mesh(g, new T.BoxGeometry(0.085, 0.015, 0.024), boot, cx, -0.025, cz);
    }
    skateSets.set(rig, { wheels, blades });
  }
  const { wheels, blades } = skateSets.get(rig);
  wheels.forEach((o) => (o.visible = !enabled));
  blades.forEach((o) => (o.visible = enabled));
}

export function penguinToy(scene) {
  const toy = new T.Group();
  scene.add(toy);
  toy.visible = false;
  function oval(color, x, y, z, w, h, d) {
    const m = new T.Mesh(new T.SphereGeometry(1, 18, 14), mat(color));
    m.position.set(x, y, z);
    m.scale.set(w, h, d);
    toy.add(m);
  }
  oval(0x253a4a, 0, 0.002, 0, 0.044, 0.056, 0.041);
  oval(0xfff0d6, 0.026, 0, 0, 0.023, 0.042, 0.034);
  oval(0x273845, 0, 0.06, 0, 0.04, 0.039, 0.038);
  for (const side of [-1, 1]) {
    oval(0xe9a046, 0.016, -0.045, side * 0.024, 0.027, 0.009, 0.016);
    oval(0x182832, -0.012, 0.007, side * 0.04, 0.024, 0.037, 0.011);
    oval(0xffffff, 0.029, 0.066, side * 0.019, 0.009, 0.01, 0.008);
    oval(0x24222a, 0.036, 0.067, side * 0.02, 0.004, 0.005, 0.004);
  }
  oval(0xe89e39, 0.041, 0.054, 0, 0.019, 0.008, 0.012);
  return toy;
}
