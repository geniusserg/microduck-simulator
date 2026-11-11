// Reel-only props for the video scenes: an empty feeding trough in the
// middle of the meadow and a flower that is anchored to a duck's actual
// jaw (its world bounding-box centre) every frame, so it reads as held
// IN the beak — never floating. Built only for ?reel=1.
import * as THREE from "three";

function buildFlower() {
  const g = new THREE.Group();
  const green = new THREE.MeshStandardMaterial({ color: 0x4f9d46, roughness: 0.7, metalness: 0 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.013, 0.24, 8), green);
  stem.position.y = 0.11;
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), green);
  leaf.scale.set(1.7, 0.35, 0.55);
  leaf.position.set(0.024, 0.11, 0);
  const center = new THREE.Mesh(
    new THREE.SphereGeometry(0.032, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5, metalness: 0 }),
  );
  center.position.y = 0.24;
  g.add(stem, leaf, center);
  const petalColors = [0xfff9d7, 0xd6c2ed, 0xffd23f, 0xfff9d7, 0xd6c2ed, 0xfff9d7];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const petal = new THREE.Mesh(
      new THREE.SphereGeometry(0.036, 8, 6),
      new THREE.MeshStandardMaterial({ color: petalColors[i], roughness: 0.5, metalness: 0 }),
    );
    petal.scale.set(1.55, 0.42, 1);
    petal.position.set(Math.cos(a) * 0.052, 0.24, Math.sin(a) * 0.052);
    petal.rotation.y = -a;
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

  // ── Empty trough (кадка), smaller, with a few leftover crumbs ─────────
  const trough = new THREE.Group();
  // shallow dish (a third of the old height) so the crumbs are visible
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

  // leftover food crumbs scattered on the bottom
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

  // ── Flower (world-anchored to whichever beak currently holds it) ──────
  const flower = buildFlower();
  flower.scale.setScalar(0.45);
  flower.visible = false;
  group.add(flower);

  const _box = new THREE.Box3();
  const _p = new THREE.Vector3();

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

  // which: "blue" | "white" | null. Repositioned every frame by the renderer.
  function flowerOn(which) {
    if (which !== "blue" && which !== "white") {
      flower.visible = false;
      return;
    }
    const rig = which === "blue" ? friendRig : mainRig;
    const beak = beakWorld(rig);
    if (!beak) {
      flower.visible = false;
      return;
    }
    const sign = which === "blue" ? -1 : 1;
    flower.position.copy(beak);
    flower.position.y += 0.02; // emerge from the mouth
    flower.rotation.set(0, 0, -sign * 0.35);
    flower.visible = true;
  }

  return {
    group,
    trough,
    flower,
    flowerOn,
  };
}
