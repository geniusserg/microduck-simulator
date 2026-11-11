// Reel-only props for the video scenes: an empty feeding trough in the
// middle of the meadow and a flower the blue duck can hold in its beak.
// Built only when the sim is opened with ?reel=1 so normal play stays
// untouched. Exposed as window.rl.reelProps for the CDP render scripts.
import * as THREE from "three";

export function createReelProps({ scene, mainRig, friendRig }) {
  const group = new THREE.Group();
  group.name = "Reel props";
  scene.add(group);

  const wood = new THREE.MeshStandardMaterial({ color: 0x9a6a3f, roughness: 0.75, metalness: 0 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x6a4526, roughness: 0.85, metalness: 0 });

  // ── Empty trough (кадка) ──────────────────────────────────────────────
  const trough = new THREE.Group();
  const tub = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.21, 0.26, 40, 1, true), wood);
  tub.position.y = 0.13;
  const inner = new THREE.Mesh(
    new THREE.CylinderGeometry(0.23, 0.18, 0.23, 40, 1, true),
    woodDark,
  );
  inner.position.y = 0.12;
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.21, 40), woodDark);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.004;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.018, 10, 48), woodDark);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.26;
  trough.add(tub, inner, bottom, rim);
  trough.position.set(0, 0, 0);
  group.add(trough);

  // ── Flower ────────────────────────────────────────────────────────────
  const flower = new THREE.Group();
  const green = new THREE.MeshStandardMaterial({ color: 0x4f9d46, roughness: 0.7, metalness: 0 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.24, 8), green);
  stem.position.y = 0.11;
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), green);
  leaf.scale.set(1.7, 0.35, 0.55);
  leaf.position.set(0.022, 0.11, 0);
  const center = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5, metalness: 0 }),
  );
  center.position.y = 0.23;
  flower.add(stem, leaf, center);
  const petalColors = [0xfff9d7, 0xd6c2ed, 0xffd23f, 0xfff9d7, 0xd6c2ed, 0xfff9d7];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const petal = new THREE.Mesh(
      new THREE.SphereGeometry(0.034, 8, 6),
      new THREE.MeshStandardMaterial({ color: petalColors[i], roughness: 0.5, metalness: 0 }),
    );
    petal.scale.set(1.55, 0.42, 1);
    petal.position.set(Math.cos(a) * 0.05, 0.23, Math.sin(a) * 0.05);
    petal.rotation.y = -a;
    flower.add(petal);
  }
  flower.scale.setScalar(0.62);
  flower.visible = false;
  group.add(flower);

  const _p = new THREE.Vector3();
  function flowerOn(rig, forwardSign) {
    const head = rig?.bodies?.get("jaw_soft");
    if (!head) return;
    head.updateWorldMatrix(true, true);
    head.getWorldPosition(_p);
    // Hold it at the beak: forward of the head, a touch lower, tilted.
    flower.position.set(_p.x + forwardSign * 0.09, _p.y - 0.03, _p.z);
    flower.rotation.z = -forwardSign * 0.4;
    flower.visible = true;
  }

  return {
    group,
    trough,
    flower,
    flowerOnWhite: () => flowerOn(mainRig, 1),
    flowerOnBlue: () => flowerOn(friendRig, -1),
    showFlower: (on) => {
      flower.visible = !!on;
    },
  };
}
