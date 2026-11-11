// Reel-only props for the video scenes: the shallow crumb trough in the
// middle of the meadow and a flower held horizontally in a duck's beak
// (stem gripped, blossom forward), laid down, and picked up again.
// Built only for ?reel=1.
import * as THREE from "three";

function buildFlower() {
  const g = new THREE.Group();
  const green = new THREE.MeshStandardMaterial({ color: 0x4f9d46, roughness: 0.7, metalness: 0 });
  // stem along +X so it can be gripped horizontally; blossom at the +X end
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.013, 0.24, 8), green);
  stem.rotation.z = Math.PI / 2;
  stem.position.x = 0.12;
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), green);
  leaf.scale.set(0.45, 1.4, 0.55);
  leaf.position.set(0.12, 0.03, 0);
  leaf.rotation.z = 0.5;
  const center = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5, metalness: 0 }),
  );
  center.position.x = 0.25;
  g.add(stem, leaf, center);
  const petalColors = [0xfff9d7, 0xd6c2ed, 0xffd23f, 0xfff9d7, 0xd6c2ed, 0xfff9d7];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const petal = new THREE.Mesh(
      new THREE.SphereGeometry(0.034, 8, 6),
      new THREE.MeshStandardMaterial({ color: petalColors[i], roughness: 0.5, metalness: 0 }),
    );
    petal.scale.set(0.42, 1.55, 1);
    petal.position.set(0.25, Math.cos(a) * 0.05, Math.sin(a) * 0.05);
    petal.rotation.x = -a;
    g.add(petal);
  }
  return g;
}

export function createReelProps({ scene, mainRig, friendRig }) {
  const group = new THREE.Group();
  group.name = "Reel props";
  scene.add(group);

  const wood = new THREE.MeshStandardMaterial({ color: 0x9a6a3f, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x6a4526, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });

  // ── Shallow trough (кадка) with leftover crumbs ───────────────────────
  const trough = new THREE.Group();
  const tub = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.17, 0.075, 40, 1, true), wood);
  tub.position.y = 0.0375;
  const inner = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.15, 0.065, 40, 1, true),
    woodDark,
  );
  inner.position.y = 0.033;
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.17, 40), woodDark);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.004;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.20, 0.012, 10, 48), woodDark);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.075;
  trough.add(tub, inner, bottom, rim);
  const crumbMats = [0xc9a15a, 0xb8863b, 0x8f6a33].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }),
  );
  const crumbGeom = new THREE.SphereGeometry(0.012, 6, 4);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + 0.4;
    const r = 0.015 + (i % 4) * 0.02;
    const crumb = new THREE.Mesh(crumbGeom, crumbMats[i % crumbMats.length]);
    crumb.scale.set(1 + (i % 3) * 0.3, 0.4, 1);
    crumb.position.set(Math.cos(a) * r, 0.016, Math.sin(a) * r);
    trough.add(crumb);
  }
  trough.position.set(0, 0, 0);
  group.add(trough);

  // ── Flower ────────────────────────────────────────────────────────────
  const flower = buildFlower();
  flower.scale.setScalar(0.5);
  flower.visible = false;
  group.add(flower);

  const _box = new THREE.Box3();
  const _p = new THREE.Vector3();
  const GROUND = new THREE.Vector3(-0.20, 0.045, 0.02);

  function beakWorld(rig) {
    const head = rig?.bodies?.get("jaw_soft");
    if (!head) return null;
    let jawMesh = null;
    head.traverse((o) => {
      if (o.isMesh && o.userData.meshName === "jaw.stl") jawMesh = o;
    });
    if (!jawMesh) return null;
    head.updateWorldMatrix(true, true);
    _box.setFromObject(jawMesh);
    if (!Number.isFinite(_box.getCenter(_p).x)) return null;
    return _box.getCenter(new THREE.Vector3());
  }

  function rigOf(which) {
    return which === "blue" ? friendRig : which === "white" ? mainRig : null;
  }

  // Hold it in a beak: stem base inside the mouth, blossom pointing forward.
  function flowerOn(which) {
    const rig = rigOf(which);
    if (!rig) {
      flower.visible = false;
      return;
    }
    const beak = beakWorld(rig);
    if (!beak) {
      flower.visible = false;
      return;
    }
    const sign = which === "blue" ? -1 : 1; // duck forward along world x
    flower.position.copy(beak);
    flower.rotation.set(0, sign > 0 ? 0 : Math.PI, 0);
    flower.visible = true;
  }

  // Lying flat on the ground in front of White.
  function flowerGround() {
    flower.position.copy(GROUND);
    flower.rotation.set(0, Math.PI, 0);
    flower.visible = true;
  }

  // Blue lowers it from its beak to the ground (u 0..1).
  function flowerLower(u) {
    const beak = beakWorld(friendRig) || GROUND;
    flower.position.lerpVectors(beak, GROUND, u);
    flower.rotation.set(0, Math.PI, 0);
    flower.visible = true;
  }

  // White lifts it from the ground into its beak (u 0..1).
  function flowerPickup(u) {
    const beak = beakWorld(mainRig) || GROUND;
    flower.position.lerpVectors(GROUND, beak, u);
    flower.rotation.set(0, Math.PI * (1 - u), 0);
    flower.visible = true;
  }

  // Beak-to-beak hand-off: the flower travels in a straight, continuous line
  // from Blue's beak to White's, while both lean in — never released, never
  // thrown (u 0..1).
  function flowerSwap(u) {
    const b = beakWorld(friendRig) || GROUND;
    const w = beakWorld(mainRig) || GROUND;
    flower.position.lerpVectors(b, w, u);
    flower.rotation.set(0, Math.PI * (1 - u), 0);
    flower.visible = true;
  }

  return {
    group,
    trough,
    flower,
    flowerOn,
    flowerGround,
    flowerLower,
    flowerPickup,
    flowerSwap,
  };
}
