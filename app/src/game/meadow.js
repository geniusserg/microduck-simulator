import { createWander } from "./wander.js";
import * as THREE from "three";
import { cloneRig, setJoint, setJawOpen } from "./duck.js";
import { applyVariant } from "./variants.js";
import {
  DEFAULT_POSE,
  JOINT_NAMES,
  OBS_SIZE,
  CMD_SIZE,
  ARENA_HALF,
  CTRL_DT,
  DECIMATION,
  ACTION_SCALE,
} from "./constants.js";

function randomGenerator(seed) {
  return () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
}

function turfTexture(random) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#91ae63";
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 180; i++) {
    const x = random() * 512,
      y = random() * 512,
      r = 12 + random() * 46;
    const tint = i % 2 ? "80,126,61" : "196,189,111";
    for (const ox of [-512, 0, 512])
      for (const oy of [-512, 0, 512]) {
        const X = x + ox,
          Y = y + oy;
        const g = ctx.createRadialGradient(X, Y, 0, X, Y, r);
        g.addColorStop(0, `rgba(${tint},.28)`);
        g.addColorStop(1, `rgba(${tint},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(X - r, Y - r, 2 * r, 2 * r);
      }
  }
  for (let i = 0; i < 24000; i++) {
    const x = random() * 512,
      y = random() * 512;
    ctx.strokeStyle = i % 3 ? "rgba(64,99,48,.22)" : "rgba(226,225,151,.5)";
    ctx.lineWidth = 0.4 + random() * 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + random() * 3 - 1, y - 1 - random() * 4);
    ctx.stroke();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

function addSky(scene) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(22, 36, 18),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `varying vec3 direction;
      void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `varying vec3 direction;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
      void main(){vec3 d=normalize(direction);float h=max(0.,d.y);
        vec3 sky=mix(vec3(.78,.90,.83),vec3(.18,.54,.85),smoothstep(0.,.48,h));
        vec2 p=d.xz/(.15+h)*2.;float n=.55*noise(p)+.28*noise(2.1*p)+.17*noise(4.3*p);
        sky=mix(sky,vec3(.98,.985,.95),.83*smoothstep(.53,.75,n)*smoothstep(.015,.11,h));
        float s=distance(d,normalize(vec3(1.,.16,-.29)));
        sky+=vec3(.35,.25,.08)*exp(-11.*s);
        sky=mix(sky,vec3(1.,.92,.62),1.-smoothstep(.034,.038,s));
        gl_FragColor=vec4(sky,1.);
        #include <colorspace_fragment>
      }`,
    }),
  );
  sky.name = "Daylight sky";
  sky.renderOrder = -10;
  scene.add(sky);
  return sky;
}

function instances(scene, name, geometry, pieces) {
  const mesh = new THREE.InstancedMesh(
    geometry,
    new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }),
    pieces.length,
  );
  const obj = new THREE.Object3D();
  pieces.forEach(([x, y, z, sx, sy, sz, angle, color], i) => {
    obj.position.set(x, y, z);
    obj.scale.set(sx, sy, sz);
    obj.rotation.y = angle;
    obj.updateMatrix();
    mesh.setMatrixAt(i, obj.matrix);
    mesh.setColorAt(i, new THREE.Color(color));
  });
  mesh.name = name;
  scene.add(mesh);
}

export function makeMeadow(world, heightAt) {
  const scene = new THREE.Group();
  scene.name = "Summer meadow";
  world.add(scene);
  const random = randomGenerator(4021);
  const sky = addSky(world);
  world.fog = new THREE.FogExp2(0xc6dcca, 0.084);
  const geometry = new THREE.PlaneGeometry(38, 38, 180, 180);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;
  geometry.setAttribute(
    "rise",
    new THREE.Float32BufferAttribute(
      Array.from({ length: pos.count }, (_, i) =>
        heightAt(pos.getX(i), -pos.getZ(i)),
      ),
      1,
    ),
  );
  const material = new THREE.MeshLambertMaterial({ map: turfTexture(random) });
  material.map.repeat.set(28, 28);
  material.uniforms = { uReveal: { value: 1 }, uTopoScale: { value: 0 } };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTopoScale = material.uniforms.uTopoScale;
    shader.vertexShader =
      "attribute float rise;uniform float uTopoScale;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n transformed.y += rise*uTopoScale;",
      );
  };
  const ground = new THREE.Mesh(geometry, material);
  ground.name = "Meadow turf";
  scene.add(ground);

  const leaves = [],
    sprigs = [],
    hills = [],
    blades = [],
    petals = [],
    centers = [];
  for (let i = 0; i < 26; i++) {
    const a = (2 * Math.PI * i) / 26,
      r = 7 + random() * 4;
    hills.push([
      r * Math.cos(a),
      -0.32,
      r * Math.sin(a),
      2 + random() * 3,
      0.65 + random() * 0.85,
      2 + random() * 2,
      a,
      random() > 0.5 ? 0x78a078 : 0x92af78,
    ]);
  }
  const foliage = [0x477e46, 0x669349, 0x769f52, 0x568748, 0x86a65a];
  for (let i = 0; i < 78; i++) {
    const a = random() * 2 * Math.PI,
      r = 1.85 + random() ** 1.6 * 4.8;
    const x = r * Math.cos(a),
      z = r * Math.sin(a);
    if (Math.max(Math.abs(x), Math.abs(z)) < ARENA_HALF + 0.16) continue;
    const size = 0.12 + random() * 0.27;
    for (let k = 0; k < 15; k++) {
      const b = random() * Math.PI * 2,
        rr = size * Math.sqrt(random());
      const h = size * (1.2 - (0.56 * rr) / size);
      const bx = x + rr * Math.cos(b),
        bz = z + rr * Math.sin(b),
        by = h * 0.39;
      leaves.push([
        bx,
        by,
        bz,
        size * 0.54,
        h * 0.7,
        size * 0.51,
        b,
        foliage[Math.floor(random() * foliage.length)],
      ]);
      for (let leaf = 0; leaf < 18; leaf++) {
        const az = random() * 2 * Math.PI,
          lift = random(),
          spread = Math.sqrt(1 - lift * lift);
        sprigs.push([
          bx + 0.54 * size * spread * Math.cos(az),
          by + 0.7 * h * lift,
          bz + 0.51 * size * spread * Math.sin(az),
          0.043 * size,
          0.025 * size,
          0.075 * size,
          az,
          foliage[Math.floor(random() * foliage.length)],
        ]);
      }
    }
  }
  const tuft = new THREE.BufferGeometry();
  const v = [];
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4,
      w = 0.0014,
      x = 0.004 * Math.cos(a),
      z = 0.004 * Math.sin(a);
    v.push(x - w, 0, z, x + w, 0, z, x * 2, 0.009 + random() * 0.018, z * 2);
  }
  tuft.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  tuft.computeVertexNormals();
  for (let i = 0; i < 8500; i++) {
    const x = (random() - 0.5) * 9,
      z = (random() - 0.5) * 9,
      s = 0.45 + random();
    blades.push([
      x,
      0,
      z,
      s,
      s,
      s,
      random() * 6.28,
      i % 3 ? 0x799b4e : 0xb3bc70,
    ]);
  }
  for (let i = 0; i < 98; i++) {
    const cx = (random() - 0.5) * 6,
      cz = (random() - 0.5) * 6;
    for (let j = 0; j < 3 + random() * 4; j++) {
      const x = cx + (random() - 0.5) * 0.12,
        z = cz + (random() - 0.5) * 0.12,
        h = 0.013 + random() * 0.009;
      centers.push([x, h + 0.001, z, 0.0027, 0.0024, 0.0027, 0, 0xefba46]);
      for (let n = 0; n < 5; n++) {
        const a = (2 * Math.PI * n) / 5;
        petals.push([
          x + 0.004 * Math.cos(a),
          h,
          z + 0.004 * Math.sin(a),
          0.0043,
          0.0014,
          0.0025,
          -a,
          i % 4 ? 0xfff9d7 : 0xd6c2ed,
        ]);
      }
    }
  }
  const sphere = new THREE.IcosahedronGeometry(1, 1);
  instances(scene, "Rolling hills", new THREE.SphereGeometry(1, 28, 14), hills);
  instances(scene, "Meadow shrubs", sphere, leaves);
  instances(scene, "Shrub leaves", new THREE.IcosahedronGeometry(1, 0), sprigs);
  instances(scene, "Grass blades", tuft, blades);
  instances(scene, "Wildflower petals", sphere, petals);
  instances(scene, "Flower centers", sphere, centers);
  return { ground, sky, group: scene };
}

export function contactShadow(scene) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const ctx = cv.getContext("2d"),
    gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, "rgba(38,52,27,.50)");
  gradient.addColorStop(1, "rgba(38,52,27,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.25, 0.18),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(cv),
      transparent: true,
      depthWrite: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  scene.add(mesh);
  return mesh;
}

export function meadowDuck(scene, source, physics) {
  const {
    mujoco,
    ort,
    model,
    data,
    policy,
    standPolicy,
    standKeyId,
    writeBodyObservation,
  } = physics;
  const root = model.jnt("blue_trunk_base_freejoint");
  const pos = Number(root.qposadr),
    dof = Number(root.dofadr);
  const qposAdr = JOINT_NAMES.map((n) =>
    Number(model.jnt("blue_" + n).qposadr),
  );
  const dofAdr = JOINT_NAMES.map((n) => Number(model.jnt("blue_" + n).dofadr));
  const gyroAdr = Number(model.sensor("blue_imu_ang_vel").adr);
  const trunkId = mujoco.mj_name2id(
    model,
    mujoco.mjtObj.mjOBJ_BODY.value,
    "blue_trunk_base",
  );
  const rig = cloneRig(source);
  applyVariant(rig, "blue");
  rig.placer.name = "Blue";
  scene.add(rig.placer);
  const trunk = rig.bodies.get("trunk_base");
  const shadow = contactShadow(scene);

  const last = new Float32Array(JOINT_NAMES.length);
  const obs = new Float32Array(OBS_SIZE);
  const command = OBS_SIZE - CMD_SIZE;
  let sportsActive = false;
  let pick = 0;
  const wander = createWander({
    arenaHalf: ARENA_HALF,
    jump: () => {
      data.qvel[dof + 2] = 1.1;
    },
    peck: physics.pickPolicy
      ? () => {
          pick = 2.8;
        }
      : undefined,
  });
  wander.start();
  let fallen = 0,
    recovering = 0,
    upright = 0;

  function reset(x, y) {
    data.qpos.set(
      model.key_qpos.subarray(
        standKeyId * model.nq + pos,
        (standKeyId + 1) * model.nq,
      ),
      pos,
    );
    data.qvel.fill(0, dof);
    data.qpos[pos] = x;
    data.qpos[pos + 1] = y;
    data.qpos[pos + 2] += physics.groundHeight(x, y);
    data.ctrl.set(DEFAULT_POSE, JOINT_NAMES.length);
    mujoco.mj_forward(model, data);
    last.fill(0);
    fallen = recovering = upright = pick = 0;
  }
  reset(0.18, -0.19);

  async function step(playerX, playerY, sportsCommand, ball) {
    sportsActive = !!sportsCommand;
    const x = data.qpos[pos],
      y = data.qpos[pos + 1];
    if (data.qpos[pos + 2] < physics.groundHeight(x, y) - 0.015) {
      reset(x, y);
      return;
    }
    writeBodyObservation(obs, data, gyroAdr, trunkId, qposAdr, dofAdr, last);
    obs.fill(0, command);
    fallen = obs[5] > -0.5 ? fallen + CTRL_DT : 0;
    if (!physics.skating && fallen > 0.2 && !recovering) recovering = CTRL_DT;
    if (recovering) {
      recovering += CTRL_DT;
      upright = obs[5] < -0.85 ? upright + CTRL_DT : 0;
      if (upright > 0.7) recovering = upright = 0;
      else if (recovering > 6) {
        reset(data.qpos[pos], data.qpos[pos + 1]);
        return;
      }
    }
    if (fallen > 0.9 && physics.skating) {
      reset(data.qpos[pos], data.qpos[pos + 1]);
      return;
    }
    if (sportsCommand) obs.set(sportsCommand, command);
    else if (!recovering && pick <= 0) {
      const q = data.qpos.subarray(pos);
      const yaw = Math.atan2(
        2 * (q[3] * q[6] + q[4] * q[5]),
        1 - 2 * (q[5] ** 2 + q[6] ** 2),
      );
      wander.update(
        CTRL_DT,
        q[0],
        q[1],
        yaw,
        ball,
        physics.skating ? [0.6, -0.5, 0.3] : [0.25, -0.2, 1],
        physics.skating,
        data.mocap_pos[2] > 0,
        [playerX, playerY],
      );
      obs.set(wander.command, command);
    }
    if (pick > 0 && !sportsCommand && !recovering) {
      const phase = (2 * Math.PI * (2.8 - pick)) / 4;
      obs[command] = Math.cos(phase);
      obs[command + 1] = Math.sin(phase);
    }
    const session = recovering
      ? standPolicy
      : pick > 0 && !sportsCommand
        ? physics.pickPolicy
        : policy;
    pick = Math.max(0, pick - CTRL_DT);
    const result = await session.run({
      [session.inputNames[0]]: new ort.Tensor("float32", obs, [1, OBS_SIZE]),
    });
    last.set(result[session.outputNames[0]].data);
    for (let j = 0; j < last.length; j++)
      data.ctrl[j + JOINT_NAMES.length] =
        DEFAULT_POSE[j] + ACTION_SCALE * last[j];
  }

  // Compare the rendered soles to the visible surface. The roller tire and
  // the leg sole meshes extend beyond the simplified contact geometry.
  const soles = [],
    shells = [];
  rig.root.traverse((o) => {
    if (
      o.isMesh &&
      /^(sole_left|sole_right|tire)\.stl$/.test(o.userData.meshName)
    ) {
      soles.push(o);
    } else if (
      o.isMesh &&
      /^(np_f970|right_shell|left_shell|bottom_head_shell|top_head_shell)\.stl$/.test(
        o.userData.meshName,
      )
    )
      shells.push(o);
  });
  let clearance = 0;
  function draw(groundHeight, breath = 0, jaw = 0, neck = null) {
    const q = data.qpos.subarray(pos);
    trunk.position.set(q[0], q[1], q[2]);
    trunk.quaternion.set(q[4], q[5], q[6], q[3]);
    for (let j = 0; j < JOINT_NAMES.length; j++)
      setJoint(
        rig,
        JOINT_NAMES[j],
        data.qpos[qposAdr[j]] +
          (neck && j >= 5 && j <= 8 ? neck[j - 5] : 0) +
          (j === 5 ? 0.16 * breath : 0),
      );
    setJawOpen(rig, jaw);
    rig.placer.position.y = 0;
    rig.placer.updateWorldMatrix(true, true);
    let low = Infinity;
    const supports =
      1 - 2 * (q[4] ** 2 + q[5] ** 2) < 0.75 ? soles.concat(shells) : soles;
    for (const sole of supports) {
      const a = sole.geometry.attributes.position,
        m = sole.matrixWorld.elements;
      for (let k = 0; k < a.count; k++)
        low = Math.min(
          low,
          m[1] * a.getX(k) + m[5] * a.getY(k) + m[9] * a.getZ(k) + m[13],
        );
    }
    if (Number.isFinite(low)) {
      rig.placer.position.y = Math.max(0, groundHeight - low);
      clearance = low + rig.placer.position.y - groundHeight;
    }
    shadow.position.set(q[0], groundHeight + 0.0009, -q[1]);
  }
  draw(0);
  return {
    step,
    draw,
    rig,
    reset,
    get clearance() {
      return clearance;
    },
    addresses: {
      pos,
      dof,
      body: trunkId,
      player: mujoco.mj_name2id(
        model,
        mujoco.mjtObj.mjOBJ_BODY.value,
        "trunk_base",
      ),
    },
    balance() {
      if (!sportsActive && !recovering)
        wander.releaseFromEdge(data.qvel, dof, CTRL_DT / DECIMATION);
      if (physics.skating) physics.steadySkates(data, false, pos, dof);
    },
    show(visible) {
      rig.placer.visible = shadow.visible = visible;
    },
    get position() {
      return data.qpos.subarray(pos);
    },
  };
}
