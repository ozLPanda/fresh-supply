import * as T from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildBoiler } from "./boilerModel";

// Illustrative cutaway, deliberately without construction dimensions.
export function buildChimney() {
  const boiler = buildBoiler();
  const root = new T.Group();
  root.add(boiler.root);
  const steel = new T.MeshStandardMaterial({
    color: 0xbac8d0,
    metalness: 0.72,
    roughness: 0.29,
    side: T.DoubleSide,
  });
  const dark = new T.MeshStandardMaterial({ color: 0x4b5a65, roughness: 0.65 });
  const wall = new T.MeshStandardMaterial({ color: 0xe2d6c4, roughness: 1 });
  const timber = new T.MeshStandardMaterial({ color: 0xb89064, roughness: 0.95 });
  const insulation = new T.MeshStandardMaterial({ color: 0xd5c793, roughness: 1 });
  const floor = new T.MeshStandardMaterial({ color: 0xc5ccce, roughness: 1 });
  const accent = new T.MeshStandardMaterial({ color: 0xe38b43, roughness: 0.7 });
  function box(
    g: T.Group,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: T.Material,
  ) {
    const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  }
  function tube(g: T.Group, y: number, height: number, radius = 0.19) {
    const mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, height, 24, 1, true), steel);
    mesh.position.set(0, y, -1.48);
    g.add(mesh);
    for (const end of [-1, 1]) {
      const ring = new T.Mesh(new T.TorusGeometry(radius, 0.012, 6, 24), steel);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, y + (end * height) / 2, -1.48);
      g.add(ring);
    }
    return mesh;
  }
  const room = new T.Group();
  root.add(room);
  box(room, 4.6, 0.12, 4.2, 0, -0.12, -0.35, floor);
  box(room, 4.6, 4.15, 0.12, 0, 2, -2.35, wall);
  // A low side return leaves the boiler and chimney visible from the default angle.
  box(room, 0.12, 1.1, 4.2, -2.24, 0.49, -0.35, wall);
  box(room, 1.85, 0.035, 2.05, 0, -0.035, -0.05, dark);
  for (let i = 0; i < 8; i++) box(room, 4.5, 0.012, 0.015, 0, 0.3 + i * 0.47, -2.278, timber);
  const groups = Array.from({ length: 5 }, () => {
    const g = new T.Group();
    root.add(g);
    return g;
  });
  const [connection, riser, passage, roofing, cap] = groups;
  // Existing boiler outlet ends at z=-.9, y=2.55.
  const connector = new T.Mesh(new T.CylinderGeometry(0.16, 0.16, 0.6, 24, 1, true), steel);
  connector.rotation.x = Math.PI / 2;
  connector.position.set(0, 2.55, -1.18);
  connection.add(connector);
  tube(connection, 2.48, 0.72);
  const lid = new T.Mesh(new T.CylinderGeometry(0.205, 0.205, 0.045, 24), dark);
  lid.position.set(0, 2.1, -1.48);
  connection.add(lid);
  box(connection, 0.62, 0.065, 0.65, 0, 2.06, -1.48, dark);
  for (const x of [-0.27, 0.27])
    for (const z of [-1.75, -1.21]) box(connection, 0.04, 2, 0.04, x, 1.03, z, dark);
  tube(riser, 3.28, 0.88);
  tube(riser, 4.12, 0.8);
  for (const y of [3.25, 3.8]) {
    box(riser, 0.58, 0.06, 0.08, 0, y, -2.25, dark);
    for (const x of [-0.24, 0.24]) box(riser, 0.035, 0.035, 0.72, x, y, -1.92, dark);
  }
  // Cutaway floor: real opening, no plane intersecting the flue.
  for (const x of [-1.4, 1.4]) box(passage, 1.8, 0.2, 1.7, x, 4.13, -1.48, timber);
  box(passage, 1, 0.2, 0.35, 0, 4.13, -2.155, timber);
  box(passage, 1, 0.2, 0.35, 0, 4.13, -0.805, timber);
  // Three walls expose the insulation from the open front of the cutaway.
  for (const x of [-0.49, 0.49]) {
    box(passage, 0.035, 0.42, 1, x, 4.12, -1.48, steel);
    box(passage, 0.25, 0.35, 0.94, x * 0.68, 4.12, -1.48, insulation);
  }
  box(passage, 1, 0.42, 0.035, 0, 4.12, -1.97, steel);
  box(passage, 0.4, 0.35, 0.25, 0, 4.12, -1.82, insulation);
  for (const x of [-0.55, 0.55]) box(passage, 0.1, 0.035, 1.12, x, 3.91, -1.48, steel);
  box(passage, 1.2, 0.035, 0.09, 0, 3.91, -0.96, steel);
  // Sloped roof strips surround a square opening, with a matching flashing.
  const roof = new T.Group();
  roof.position.set(0, 5.28, -1.48);
  roof.rotation.z = 0.16;
  roofing.add(roof);
  for (const x of [-1.43, 1.43]) box(roof, 1.84, 0.1, 2.3, x, 0, 0, dark);
  for (const z of [-0.84, 0.84]) box(roof, 1.02, 0.1, 0.62, 0, 0, z, dark);
  for (const x of [-2, -1.6, -1.2, -0.8, 0.8, 1.2, 1.6, 2])
    box(roof, 0.028, 0.025, 2.3, x, 0.063, 0, steel);
  for (const x of [-0.4, 0.4]) box(roof, 0.25, 0.04, 1.05, x, 0.09, 0, steel);
  for (const z of [-0.4, 0.4]) box(roof, 0.55, 0.04, 0.25, 0, 0.09, z, steel);
  const flashing = new T.Mesh(new T.CylinderGeometry(0.215, 0.38, 0.42, 24, 1, true), steel);
  flashing.position.set(0, 5.46, -1.48);
  roofing.add(flashing);
  tube(roofing, 5.12, 1.2);
  tube(roofing, 5.98, 0.52);
  tube(cap, 6.32, 0.16, 0.205);
  for (let i = 0; i < 3; i++) {
    const angle = (i * Math.PI * 2) / 3;
    box(
      cap,
      0.035,
      0.26,
      0.035,
      Math.cos(angle) * 0.19,
      6.48,
      -1.48 + Math.sin(angle) * 0.19,
      steel,
    );
  }
  const umbrella = new T.Mesh(new T.ConeGeometry(0.37, 0.13, 32), steel);
  umbrella.position.set(0, 6.64, -1.48);
  cap.add(umbrella);
  // An orange rim makes the final assembly easy to identify without glow effects.
  const rim = new T.Mesh(new T.TorusGeometry(0.37, 0.009, 6, 32), accent);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, 6.575, -1.48);
  cap.add(rim);
  // Merge static parts per stage/material, keeping the assembly animation inexpensive.
  for (const group of [room, ...groups]) {
    group.updateMatrixWorld(true);
    const batches = new Map<T.Material, T.BufferGeometry[]>();
    group.traverse((obj) => {
      if (obj instanceof T.Mesh) {
        const geometry = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
        geometry.applyMatrix4(obj.matrixWorld);
        const list = batches.get(obj.material) ?? [];
        list.push(geometry);
        batches.set(obj.material, list);
        obj.geometry.dispose();
      }
    });
    group.clear();
    for (const [material, geometries] of batches) {
      const merged = mergeGeometries(geometries);
      geometries.forEach((g) => g.dispose());
      if (merged) group.add(new T.Mesh(merged, material));
    }
  }
  const starts = [0, 4, 8, 12, 17];
  return {
    root,
    textures: boiler.textures,
    pose(time: number) {
      groups.forEach((group, i) => {
        const progress = T.MathUtils.smoothstep(time, starts[i], starts[i] + 3);
        group.visible = time >= starts[i];
        group.position.set((1 - progress) * (i === 0 ? 1.5 : 0.7), (1 - progress) * 0.9, 0);
      });
    },
  };
}
