import * as THREE from "three";

const red = new THREE.MeshStandardMaterial({
  color: 0xc31d32,
  roughness: 0.92,
});
const cream = new THREE.MeshStandardMaterial({ color: 0xfff4dd, roughness: 1 });
const green = new THREE.MeshStandardMaterial({
  color: 0x176044,
  roughness: 0.95,
});
const outfits = new WeakMap();

function addMesh(parent, geometry, material, position, scale = [1, 1, 1]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function makeOutfit(rig) {
  const head = rig.bodies.get("jaw_soft");
  const shell = head.children.find(
    (child) => child.userData.meshName === "top_head_shell.stl",
  );
  // The head's local X axis points up. Measure the shell in that frame so
  // the fur brim sits on the crown and follows its pitch and roll.
  const bounds = new THREE.Box3();
  const vertex = new THREE.Vector3();
  const points = shell.geometry.attributes.position;
  shell.updateMatrix();
  for (let i = 0; i < points.count; i++)
    bounds.expandByPoint(
      vertex.fromBufferAttribute(points, i).applyMatrix4(shell.matrix),
    );
  const center = bounds.getCenter(new THREE.Vector3());
  const hat = new THREE.Group();
  hat.name = "Santa hat";
  hat.position.set(bounds.max.x - 0.005, center.y, center.z + 0.004);
  hat.rotation.z = -Math.PI / 2;
  head.add(hat);
  const radius = Math.min(0.043, (bounds.max.y - bounds.min.y) * 0.48);
  const profile = [
    [0, 1, 0],
    [0.011, 0.93, 0.001],
    [0.026, 0.66, 0.008],
    [0.039, 0.38, 0.019],
    [0.042, 0.19, 0.035],
    [0.034, 0.015, 0.046],
  ];
  const vertices = [],
    indices = [];
  const segments = 40;
  for (const [height, width, lean] of profile) {
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * 2 * Math.PI;
      vertices.push(
        lean + radius * width * Math.cos(a),
        height,
        radius * width * 0.87 * Math.sin(a),
      );
      const n = vertices.length / 3 - 1;
      if (j && n > segments)
        indices.push(
          n - segments - 2,
          n - 1,
          n,
          n - segments - 2,
          n,
          n - segments - 1,
        );
    }
  }
  const cloth = new THREE.BufferGeometry();
  cloth.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  cloth.setIndex(indices);
  cloth.computeVertexNormals();
  addMesh(hat, cloth, red, [0, 0, 0]);
  const ball = new THREE.SphereGeometry(1, 24, 16);
  addMesh(
    hat,
    ball,
    cream,
    [0, 0.002, 0],
    [radius * 1.06, 0.009, radius * 0.93],
  );
  addMesh(hat, ball, cream, [0.046, 0.031, 0], [0.011, 0.011, 0.011]);

  const scarf = new THREE.Group();
  scarf.name = "Christmas scarf";
  rig.bodies.get("trunk_base").add(scarf);
  const collar = addMesh(
    scarf,
    new THREE.TorusGeometry(0.039, 0.0065, 12, 40),
    green,
    [0.002, 0, 0.02],
    [0.9, 1.12, 1],
  );
  collar.rotation.y = -0.12;
  const tail = new THREE.Group();
  tail.position.set(0.012, -0.041, 0.018);
  tail.rotation.x = -0.22;
  scarf.add(tail);
  addMesh(
    tail,
    new THREE.BoxGeometry(0.014, 0.005, 0.041),
    green,
    [0, 0, -0.018],
  );
  for (const z of [-0.026, -0.033])
    addMesh(tail, new THREE.BoxGeometry(0.0143, 0.0054, 0.003), cream, [
      0,
      0,
      z,
    ]);
  return [hat, scarf];
}

export function dressForChristmas(rig, enabled) {
  if (enabled && !outfits.has(rig)) outfits.set(rig, makeOutfit(rig));
  for (const part of outfits.get(rig) ?? []) part.visible = enabled;
}
