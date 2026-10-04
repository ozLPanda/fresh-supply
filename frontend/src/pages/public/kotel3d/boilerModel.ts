import * as T from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Approximate proportions reconstructed from the supplied views, not engineering dimensions.
export function buildBoiler() {
  const root = new T.Group();
  const steel = new T.MeshStandardMaterial({ color: 0x30343b, roughness: 0.72, metalness: 0.55 });
  const edge = new T.MeshStandardMaterial({ color: 0x454a50, roughness: 0.6, metalness: 0.65 });
  const dark = new T.MeshStandardMaterial({ color: 0x11151a, roughness: 0.95 });
  const silver = new T.MeshStandardMaterial({ color: 0x929ca4, roughness: 0.45, metalness: 0.75 });
  const brass = new T.MeshStandardMaterial({ color: 0xb59042, roughness: 0.48, metalness: 0.6 });
  const blue = new T.MeshStandardMaterial({ color: 0x0877b9, roughness: 0.6 });
  const gasket = new T.MeshStandardMaterial({ color: 0xafa99a, roughness: 1 });
  const textures: T.Texture[] = [];
  function box(
    parent: T.Group,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat = steel,
  ) {
    const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  function cylinder(
    parent: T.Group,
    r: number,
    h: number,
    x: number,
    y: number,
    z: number,
    mat = steel,
    front = false,
  ) {
    const mesh = new T.Mesh(new T.CylinderGeometry(r, r, h, 20), mat);
    mesh.position.set(x, y, z);
    if (front) mesh.rotation.x = Math.PI / 2;
    parent.add(mesh);
    return mesh;
  }
  function label(
    parent: T.Group,
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    draw: (ctx: CanvasRenderingContext2D) => void,
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    draw(ctx);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    textures.push(texture);
    const plane = new T.Mesh(
      new T.PlaneGeometry(w, h),
      new T.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    plane.position.set(x, y, z);
    parent.add(plane);
    return plane;
  }
  // Hollow welded shell: the angled front is deliberately open behind its hinged lid.
  const profile = new T.Shape();
  profile.moveTo(0.65, 0.16);
  profile.lineTo(-0.72, 0.16);
  profile.lineTo(-0.72, 1.85);
  profile.lineTo(-0.22, 2.85);
  profile.lineTo(0.65, 2.85);
  profile.closePath();
  const sideGeometry = new T.ExtrudeGeometry(profile, { depth: 0.045, bevelEnabled: false });
  sideGeometry.rotateY(Math.PI / 2);
  for (const x of [-0.69, 0.645]) {
    const m = new T.Mesh(sideGeometry, steel);
    m.position.x = x;
    root.add(m);
  }
  box(root, 1.38, 2.69, 0.06, 0, 1.505, -0.65);
  box(root, 1.34, 0.06, 0.88, 0, 2.83, -0.21);
  box(root, 1.38, 0.09, 1.36, 0, 0.17, 0.02);
  // No solid partition above the ash chamber: ash passes through the grate.
  // The loading hopper and combustion chamber share an unobstructed interior.
  // Continuous front plate from y=1.16 to y=1.85, without a gap between sections.
  box(root, 1.4, 0.69, 0.12, 0, 1.505, 0.75);
  box(root, 0.065, 0.62, 0.09, -0.65, 0.82, 0.74, edge);
  box(root, 0.065, 0.62, 0.09, 0.65, 0.82, 0.74, edge);
  box(root, 1.3, 0.05, 0.05, 0, 0.51, 0.74, edge);
  box(root, 1.3, 0.05, 0.05, 0, 1.13, 0.74, edge);
  for (const x of [-0.61, 0.61])
    for (const z of [-0.54, 0.6]) box(root, 0.13, 0.24, 0.13, x, 0.08, z, dark);
  for (const x of [-0.72, 0.72]) {
    box(root, 0.09, 0.2, 1.4, x, 1.27, 0.0, edge);
    box(root, 0.07, 1.0, 0.07, x, 0.72, -0.09, edge);
    for (const y of [0.6, 1.95, 2.5]) box(root, 0.016, 0.028, 0.16, x, y, -0.2, edge);
  }
  for (let i = 0; i < 9; i++) box(root, 0.055, 0.055, 1.34, -0.52 + i * 0.13, 0.49, 0.04, edge);
  const upperFrame = new T.Group();
  upperFrame.position.set(0, 2.33, 0.49);
  upperFrame.rotation.x = -Math.atan(0.5);
  root.add(upperFrame);
  for (const x of [-0.66, 0.66]) box(upperFrame, 0.055, 1.09, 0.07, x, 0, 0, edge);
  for (const y of [-0.52, 0.52]) box(upperFrame, 1.35, 0.05, 0.07, 0, y, 0, edge);
  function door(parent: T.Group, height: number, y: number, z: number, logo = false) {
    const hinge = new T.Group();
    hinge.position.set(0.69, y, z);
    parent.add(hinge);
    box(hinge, 1.36, height, 0.075, -0.68, 0, 0.025);
    box(hinge, 1.22, height - 0.12, 0.04, -0.68, 0, -0.032, dark);
    for (const x of [-1.29, -0.07]) box(hinge, 0.025, height - 0.1, 0.028, x, 0, -0.067, gasket);
    for (const yy of [-height / 2 + 0.05, height / 2 - 0.05])
      box(hinge, 1.25, 0.025, 0.028, -0.68, yy, -0.067, gasket);
    for (const yy of [-height * 0.34, height * 0.34]) {
      cylinder(hinge, 0.031, 0.13, 0, yy, 0.01, silver);
      box(hinge, 0.12, 0.08, 0.04, -0.05, yy, 0.075, edge);
    }
    box(hinge, 0.055, 0.17, 0.055, -1.27, -height * 0.18, 0.13, silver);
    const handle = box(hinge, 0.045, 0.22, 0.06, -1.29, -height * 0.18 - 0.04, 0.19, dark);
    handle.rotation.z = -0.22;
    if (logo)
      label(hinge, 0.78, 0.28, -0.65, 0, 0.066, (ctx) => {
        ctx.strokeStyle = "#ef4b33";
        ctx.lineWidth = 12;
        ctx.beginPath();
        ctx.moveTo(30, 184);
        ctx.lineTo(92, 58);
        ctx.lineTo(480, 58);
        ctx.lineTo(430, 184);
        ctx.stroke();
        ctx.fillStyle = "#ef4b33";
        ctx.font = "italic 900 82px Arial";
        ctx.textAlign = "center";
        ctx.fillText("ГОРНЯК", 258, 153);
      });
    return hinge;
  }
  const upperDoor = door(upperFrame, 1.06, 0, 0.025, true);
  const fireDoor = door(root, 0.64, 0.82, 0.8);
  const ashDoor = door(root, 0.27, 0.32, 0.79);
  // Boiler fittings, gauge, control unit and snail-shaped blower.
  for (const x of [-0.72, 0.72]) {
    const fitting = cylinder(root, 0.058, 0.11, x, 0.32, 0.5, brass);
    fitting.rotation.z = Math.PI / 2;
    const cap = cylinder(root, 0.061, 0.04, x * 1.09, 0.32, 0.5, blue);
    cap.rotation.z = Math.PI / 2;
  }
  cylinder(root, 0.04, 0.15, -0.46, 2.93, 0.04, brass);
  cylinder(root, 0.108, 0.075, -0.46, 3.06, 0.04, silver, true);
  label(root, 0.41, 0.205, -0.46, 3.06, 0.082, (ctx) => {
    ctx.fillStyle = "#e4e9e8";
    ctx.beginPath();
    ctx.arc(256, 128, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#263a46";
    ctx.lineWidth = 4;
    for (let i = 0; i < 11; i++) {
      const a = Math.PI * 0.75 + (i * Math.PI * 1.5) / 10;
      ctx.beginPath();
      ctx.moveTo(256 + Math.cos(a) * 90, 128 + Math.sin(a) * 90);
      ctx.lineTo(256 + Math.cos(a) * 108, 128 + Math.sin(a) * 108);
      ctx.stroke();
    }
    ctx.strokeStyle = "#d7442a";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(256, 128);
    ctx.lineTo(205, 65);
    ctx.stroke();
  });
  box(root, 0.39, 0.24, 0.15, -0.03, 2.99, 0.035, dark);
  label(root, 0.34, 0.2, -0.03, 2.99, 0.115, (ctx) => {
    ctx.fillStyle = "#161f29";
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = "#516978";
    ctx.fillRect(30, 25, 290, 115);
    ctx.fillStyle = "#83d7b7";
    ctx.font = "70px monospace";
    ctx.fillText("65°C", 45, 108);
    ctx.fillStyle = "#b8c4c9";
    ctx.font = "24px Arial";
    ctx.fillText("КОНТРОЛЛЕР", 30, 210);
    ctx.fillStyle = "#e6553c";
    ctx.fillRect(375, 150, 65, 55);
  });
  cylinder(root, 0.2, 0.16, 0.42, 3.09, -0.25, silver, true);
  cylinder(root, 0.154, 0.015, 0.42, 3.09, -0.157, edge, true);
  cylinder(root, 0.132, 0.016, 0.42, 3.09, -0.144, silver, true);
  box(root, 0.21, 0.14, 0.21, 0.43, 2.94, -0.29, silver);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const screw = cylinder(
      root,
      0.009,
      0.012,
      0.42 + Math.cos(a) * 0.172,
      3.09 + Math.sin(a) * 0.172,
      -0.158,
      dark,
      true,
    );
    screw.name = "blower-bolt";
  }
  cylinder(root, 0.105, 0.19, -0.3, 2.9, -0.4, steel);
  cylinder(root, 0.112, 0.035, -0.3, 3, -0.4, blue);
  cylinder(root, 0.045, 0.2, -0.05, 2.96, -0.45, brass);
  cylinder(root, 0.05, 0.055, -0.05, 3.065, -0.45, new T.MeshStandardMaterial({ color: 0xc73125 }));
  cylinder(root, 0.16, 0.24, 0, 2.55, -0.78, edge, true);
  for (let i = 0; i < 3; i++) {
    const curve = new T.CatmullRomCurve3([
      new T.Vector3(-0.12, 2.9, 0.08),
      new T.Vector3(-0.3 + i * 0.12, 2.87, 0.22),
      new T.Vector3(0.18, 2.91, -0.05),
      new T.Vector3(0.42, 2.98, -0.3),
    ]);
    root.add(new T.Mesh(new T.TubeGeometry(curve, 16, 0.012, 5, false), dark));
  }
  // Merge static parts per material within each rigid group, keeping hinge groups separate.
  function compact(group: T.Group) {
    const buckets = new Map<T.Material, T.BufferGeometry[]>();
    const meshes: T.Mesh[] = [];
    for (const child of [...group.children]) {
      if (child instanceof T.Group) {
        compact(child);
        continue;
      }
      if (!(child instanceof T.Mesh) || Array.isArray(child.material)) continue;
      child.updateMatrix();
      const geometry = (
        child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone()
      ).applyMatrix4(child.matrix);
      const batch = buckets.get(child.material) ?? [];
      batch.push(geometry);
      buckets.set(child.material, batch);
      meshes.push(child);
    }
    for (const mesh of meshes) {
      group.remove(mesh);
      mesh.geometry.dispose();
    }
    for (const [material, geometries] of buckets) {
      const merged = mergeGeometries(geometries, false);
      if (merged) group.add(new T.Mesh(merged, material));
      geometries.forEach((g) => g.dispose());
    }
  }
  compact(root);
  return { root, upperDoor, fireDoor, ashDoor, textures };
}
