import * as T from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildBoiler } from "./boilerModel";

import { DURATION, stageAt } from "./timeline";
export type SceneStatus = { time: number; playing: boolean; stage: number };
export type BoilerScene = {
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  resetView: () => void;
  moveCamera: (direction: number) => void;
  dispose: () => void;
};
const clamp = T.MathUtils.clamp;
const ease = (a: number, b: number, t: number) => T.MathUtils.smoothstep(t, a, b);

export function createBoilerScene(
  host: HTMLDivElement,
  onStatus: (s: SceneStatus) => void,
  onError: () => void,
): BoilerScene {
  const mobile = matchMedia("(pointer: coarse)").matches || host.clientWidth < 700;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const renderer = new T.WebGLRenderer({
    antialias: !mobile,
    alpha: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.25 : 1.75));
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  const canvas = renderer.domElement;
  canvas.setAttribute(
    "aria-label",
    "3D-модель котла Горняк. Перетаскивайте для вращения. Два пальца на трекпаде: вверх и вниз — высота камеры, влево и вправо — вращение. Щипок или Ctrl с колесом меняет масштаб.",
  );
  canvas.setAttribute("role", "img");
  host.append(canvas);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(38, 1, 0.1, 40);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.enablePan = false;
  controls.minDistance = 3.4;
  controls.maxDistance = 10;
  controls.maxPolarAngle = Math.PI * 0.52;
  controls.minPolarAngle = 0.3;
  scene.add(new T.HemisphereLight(0xd7eaff, 0x64625c, 3));
  const key = new T.DirectionalLight(0xfff2e4, 4);
  key.position.set(-3, 6, 5);
  scene.add(key);
  const rim = new T.DirectionalLight(0xc4e0ff, 3);
  rim.position.set(3, 4, -3);
  scene.add(rim);
  const model = buildBoiler();
  scene.add(model.root);
  // Static studio pedestal, no shadow map or post-processing passes.
  const plinth = new T.Mesh(
    new T.CylinderGeometry(1.45, 1.48, 0.07, 64),
    new T.MeshStandardMaterial({ color: 0xd2d8dc, roughness: 0.95 }),
  );
  plinth.position.y = -0.08;
  scene.add(plinth);
  const ring = new T.Mesh(
    new T.TorusGeometry(1.42, 0.008, 6, 64),
    new T.MeshBasicMaterial({ color: 0xa5b1b8 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.04;
  scene.add(ring);
  const coalMaterial = new T.MeshStandardMaterial({
    color: 0x171619,
    roughness: 1,
    emissive: 0xff3a00,
    emissiveIntensity: 0,
  });
  const coalGeometry = new T.DodecahedronGeometry(0.105, 0);
  const count = mobile ? 24 : 40;
  const coal = new T.InstancedMesh(coalGeometry, coalMaterial, count);
  coal.instanceMatrix.setUsage(T.DynamicDrawUsage);
  coal.frustumCulled = false;
  scene.add(coal);
  const dummy = new T.Object3D();
  // Deterministic positions: no randomness or object allocation in the render loop.
  const chunks = Array.from({ length: count }, (_, i) => ({
    x: Math.sin(i * 7.13) * 0.48,
    z: 0.08 + Math.cos(i * 3.17) * 0.39,
    y: 0.57 + Math.floor(i / 12) * 0.09,
    delay: (i / count) * 2.4,
    scale: 0.7 + (i % 5) * 0.13,
  }));
  const ashCount = mobile ? 64 : 96;
  const ashGeometry = new T.IcosahedronGeometry(0.018, 0);
  const ashMaterial = new T.MeshStandardMaterial({ color: 0x99938a, roughness: 1 });
  const ash = new T.InstancedMesh(ashGeometry, ashMaterial, ashCount);
  ash.instanceMatrix.setUsage(T.DynamicDrawUsage);
  ash.frustumCulled = false;
  scene.add(ash);
  // Each stream passes through a gap between grate bars, never through a bar.
  const ashParticles = Array.from({ length: ashCount }, (_, i) => ({
    x: -0.455 + (i % 8) * 0.13,
    z: -0.38 + (Math.floor(i / 8) % 6) * 0.15,
    y: 0.244 + Math.floor(i / 48) * 0.023,
    delay: (i / ashCount) * 2.8,
  }));
  const coalColor = new T.Color(0x171619);
  const spentColor = new T.Color(0x77736e);
  const scoop = new T.Group();
  // Point the open lip toward the boiler, with the handle facing the viewer.
  scoop.rotation.y = Math.PI;
  scene.add(scoop);
  const scoopMat = new T.MeshStandardMaterial({ color: 0x697781, metalness: 0.6, roughness: 0.5 });
  function part(w: number, h: number, d: number, x: number, y: number, z: number) {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), scoopMat);
    m.position.set(x, y, z);
    scoop.add(m);
  }
  part(0.75, 0.035, 0.55, 0, 0, 0);
  part(0.035, 0.2, 0.55, -0.37, 0.1, 0);
  part(0.035, 0.2, 0.55, 0.37, 0.1, 0);
  part(0.75, 0.2, 0.035, 0, 0.1, -0.27);
  part(0.11, 0.06, 0.64, 0, 0.04, -0.57);
  const scoopCoal = new T.InstancedMesh(coalGeometry, coalMaterial, 12);
  for (let i = 0; i < 12; i++) {
    dummy.position.set(
      ((i % 4) - 0.5 * 3) * 0.16,
      0.09 + Math.floor(i / 8) * 0.1,
      (Math.floor(i / 4) - 1) * 0.14,
    );
    dummy.rotation.set(i, i * 0.8, 0);
    dummy.scale.setScalar(0.72);
    dummy.updateMatrix();
    scoopCoal.setMatrixAt(i, dummy.matrix);
  }
  scoop.add(scoopCoal);
  // One small shared radial texture for flames and sparks, instead of volumetric fire.
  const flameCanvas = document.createElement("canvas");
  flameCanvas.width = 64;
  flameCanvas.height = 64;
  const ctx = flameCanvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32, 36, 0, 32, 36, 29);
  gradient.addColorStop(0, "rgba(255,255,210,1)");
  gradient.addColorStop(0.23, "rgba(255,188,48,.85)");
  gradient.addColorStop(0.6, "rgba(245,70,6,.3)");
  gradient.addColorStop(1, "rgba(200,30,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const flameTexture = new T.CanvasTexture(flameCanvas);
  flameTexture.colorSpace = T.SRGBColorSpace;
  const fire = new T.Group();
  scene.add(fire);
  const flameMaterial = new T.SpriteMaterial({
    map: flameTexture,
    color: 0xffb15d,
    transparent: true,
    blending: T.AdditiveBlending,
    depthWrite: false,
  });
  const flames = Array.from({ length: mobile ? 7 : 12 }, (_, i) => {
    const sprite = new T.Sprite(flameMaterial);
    sprite.position.set(Math.sin(i * 4) * 0.44, 0.74, 0.34 + Math.cos(i * 5) * 0.2);
    fire.add(sprite);
    return sprite;
  });
  const glow = new T.PointLight(0xff7b23, 0, 3, 2);
  glow.position.set(0, 0.8, 0.5);
  scene.add(glow);
  let time = 0,
    playing = !reduced.matches,
    visible = false,
    disposed = false,
    lost = false,
    raf = 0,
    last = 0,
    lastStatus = -1,
    lastCoalTime = -1,
    lastAshTime = -1;
  const frameInterval = 1000 / (mobile ? 30 : 45);
  function publish(force = false) {
    const tick = Math.floor(time * 5);
    if (force || tick !== lastStatus) {
      lastStatus = tick;
      onStatus({ time, playing, stage: stageAt(time) });
    }
  }
  function pose() {
    const open = ease(0.7, 2.8, time);
    model.upperDoor.rotation.y = 2.1 * open * (1 - ease(15, 18, time));
    model.fireDoor.rotation.y = 2.15 * ease(8, 10, time); // Remains open for the combustion demonstration.
    model.ashDoor.rotation.y = 0.14 * ease(9, 11, time) + 2.15 * ease(22, 24, time);
    const cleaning = time >= 25.5;
    const collect = ease(27.5, 28.5, time);
    const withdraw = ease(28, 30.5, time);
    const leave = ease(30.5, 32, time);
    scoop.visible = (time >= 3 && time < 8.8) || (cleaning && time < DURATION);
    scoop.position.set(-1.8 * (1 - ease(3, 4, time)), 3.22 + 0.8 * ease(8, 8.8, time), 0.72);
    scoop.rotation.x = -0.75 * ease(4, 5, time);
    scoop.scale.set(cleaning ? 1.35 : 1, cleaning ? 0.6 : 1, 1);
    if (cleaning) {
      scoop.position.set(
        -1.8 * leave,
        0.25 + 0.12 * withdraw,
        T.MathUtils.lerp(1.45, 0.1, ease(25.5, 27.5, time)) + 1.45 * withdraw,
      );
      scoop.rotation.x = 0;
    }
    scoopCoal.visible = time < 6;
    const burnout = ease(20, 24, time);
    coal.visible = time >= 4 && time < 24;
    const coalTime = time < 20 ? clamp(time, 4, 8) : clamp(time, 20, 24);
    if (coalTime !== lastCoalTime) {
      lastCoalTime = coalTime;
      for (let i = 0; i < count; i++) {
        const c = chunks[i];
        const fall = clamp((time - 4.2 - c.delay) / 1.25, 0, 1);
        dummy.position.set(
          c.x,
          3.35 + (c.y - 3.35) * fall * fall - (c.y - 0.52) * burnout,
          T.MathUtils.lerp(0.85 - 0.55 * fall, c.z, ease(0.72, 1, fall)),
        );
        dummy.rotation.set(i + fall, i * 0.7, i * 0.31);
        dummy.scale.setScalar(time < 4.2 + c.delay ? 0 : c.scale * (1 - burnout));
        dummy.updateMatrix();
        coal.setMatrixAt(i, dummy.matrix);
      }
      coal.instanceMatrix.needsUpdate = true;
    }
    ash.visible = time >= 20 && time < DURATION;
    const ashTime = clamp(time, 20, DURATION);
    if (ashTime !== lastAshTime) {
      lastAshTime = ashTime;
      for (let i = 0; i < ashCount; i++) {
        const p = ashParticles[i];
        const fall = clamp((time - 20 - p.delay) / 0.9, 0, 1);
        const y = T.MathUtils.lerp(0.59, p.y, fall * fall);
        dummy.position.set(
          T.MathUtils.lerp(p.x, scoop.position.x + p.x * 0.8, collect),
          T.MathUtils.lerp(y, scoop.position.y + 0.033 + (i % 3) * 0.015, collect),
          T.MathUtils.lerp(p.z, scoop.position.z + p.z * 0.45, collect),
        );
        dummy.rotation.set(i * 0.7, i, fall);
        dummy.scale.setScalar(time < 20 + p.delay ? 0 : 1);
        dummy.updateMatrix();
        ash.setMatrixAt(i, dummy.matrix);
      }
      ash.instanceMatrix.needsUpdate = true;
    }
    const burn = ease(9, 12, time) * (1 - ease(20, 23, time));
    coalMaterial.color.copy(coalColor).lerp(spentColor, burnout);
    fire.visible = burn > 0;
    coalMaterial.emissiveIntensity = burn * 0.65;
    glow.intensity = burn * (2.2 + 0.2 * Math.sin(time * 7));
    flameMaterial.opacity = burn * 0.88;
    for (let i = 0; i < flames.length; i++) {
      const f = flames[i];
      const pulse = 0.5 + 0.5 * Math.sin(time * 6 + i * 2.5);
      f.scale.set(0.18 + pulse * 0.08, 0.25 + pulse * 0.32, 1);
      f.position.y = 0.69 + f.scale.y * 0.4;
    }
    // Useful, non-sensitive runtime diagnostics for inspecting the live canvas.
    canvas.dataset.stage = String(stageAt(time));
    canvas.dataset.time = time.toFixed(2);
  }
  function draw() {
    if (disposed || lost || !visible || document.hidden) return;
    renderer.render(scene, camera);
    canvas.dataset.drawCalls = String(renderer.info.render.calls);
    canvas.dataset.triangles = String(renderer.info.render.triangles);
  }
  function frame(now: number) {
    raf = 0;
    if (disposed || lost || !playing || !visible || document.hidden) return;
    if (!last) last = now;
    const elapsed = now - last;
    if (elapsed >= frameInterval) {
      time = Math.min(DURATION, time + Math.min(elapsed / 1000, 0.1));
      last = now;
      pose();
      draw();
      publish();
      if (time >= DURATION) {
        playing = false;
        sync();
        publish(true);
      }
    }
    if (playing) raf = requestAnimationFrame(frame);
  }
  function sync() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    canvas.dataset.rendering = String(playing && visible && !document.hidden && !lost);
    if (playing && visible && !document.hidden && !lost) raf = requestAnimationFrame(frame);
  }
  function resetView() {
    camera.position.set(mobile ? 3.5 : 4.1, mobile ? 3 : 3.2, mobile ? 5.1 : 6);
    controls.target.set(0.15, 1.58, 0);
    controls.update();
    draw();
  }
  function moveCamera(direction: number) {
    // Translate camera and orbit target together, preserving viewing angle and zoom.
    const height = clamp(controls.target.y + direction * 0.2, 0.2, 3.4);
    camera.position.y += height - controls.target.y;
    controls.target.y = height;
    controls.update();
  }
  let panFrame = 0;
  let pendingPan = 0;
  let pendingRotation = 0;
  const orbitOffset = new T.Vector3();
  const orbitAxis = new T.Vector3(0, 1, 0);
  function onWheel(event: WheelEvent) {
    // Trackpad pinch is a Ctrl+wheel event: let OrbitControls retain its zoom handling.
    if (event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (disposed || lost || document.hidden) return;
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 600 : 1;
    pendingPan -= clamp(event.deltaY * units, -120, 120) * 0.015;
    pendingRotation += clamp(event.deltaX * units, -120, 120) * 0.004;
    // Coalesce high-frequency trackpad events into one camera update per frame.
    if (!panFrame)
      panFrame = requestAnimationFrame(() => {
        panFrame = 0;
        if (!disposed && !lost && !document.hidden) {
          // Rotate around the current target without changing height or zoom.
          orbitOffset.copy(camera.position).sub(controls.target);
          orbitOffset.applyAxisAngle(orbitAxis, pendingRotation);
          camera.position.copy(controls.target).add(orbitOffset);
          moveCamera(pendingPan);
        }
        pendingPan = 0;
        pendingRotation = 0;
      });
  }
  canvas.addEventListener("wheel", onWheel, { capture: true, passive: false });
  function resize() {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = width / height < 0.8 ? 48 : 38;
    camera.updateProjectionMatrix();
    draw();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
    draw();
  });
  intersection.observe(host);
  const visibility = () => {
    sync();
    draw();
  };
  document.addEventListener("visibilitychange", visibility);
  const motionChange = () => {
    if (reduced.matches) {
      playing = false;
      sync();
      publish(true);
    }
  };
  reduced.addEventListener("change", motionChange);
  const contextLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    playing = false;
    sync();
    onError();
  };
  canvas.addEventListener("webglcontextlost", contextLost);
  controls.addEventListener("change", draw);
  pose();
  resetView();
  resize();
  publish(true);
  function dispose() {
    disposed = true;
    if (panFrame) cancelAnimationFrame(panFrame);
    canvas.removeEventListener("wheel", onWheel, true);
    if (raf) cancelAnimationFrame(raf);
    resizeObserver.disconnect();
    intersection.disconnect();
    document.removeEventListener("visibilitychange", visibility);
    reduced.removeEventListener("change", motionChange);
    canvas.removeEventListener("webglcontextlost", contextLost);
    controls.dispose();
    const geometries = new Set<T.BufferGeometry>();
    const materials = new Set<T.Material>();
    scene.traverse((obj) => {
      if (obj instanceof T.Mesh) {
        geometries.add(obj.geometry);
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) =>
          materials.add(m),
        );
        if (obj instanceof T.InstancedMesh) obj.dispose();
      } else if (obj instanceof T.Sprite) materials.add(obj.material);
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    model.textures.forEach((t) => t.dispose());
    flameTexture.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  }
  return {
    play() {
      if (time >= DURATION) time = 0;
      playing = true;
      pose();
      sync();
      publish(true);
    },
    pause() {
      playing = false;
      sync();
      publish(true);
    },
    seek(value) {
      time = clamp(value, 0, DURATION);
      pose();
      draw();
      publish(true);
    },
    resetView,
    moveCamera,
    dispose,
  };
}
