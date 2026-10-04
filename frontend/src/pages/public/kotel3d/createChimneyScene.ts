import * as T from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildChimney } from "./chimneyModel";

import { DURATION, stageAt } from "./chimneyTimeline";
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

export function createChimneyScene(
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
    "3D-сцена монтажа дымохода. Перетаскивайте для вращения. Два пальца на трекпаде: вверх и вниз — высота камеры, влево и вправо — вращение. Щипок или Ctrl с колесом меняет масштаб.",
  );
  canvas.setAttribute("role", "img");
  host.append(canvas);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(38, 1, 0.1, 40);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.enablePan = false;
  controls.minDistance = 3.4;
  controls.maxDistance = 22;
  controls.maxPolarAngle = Math.PI * 0.52;
  controls.minPolarAngle = 0.3;
  scene.add(new T.HemisphereLight(0xd7eaff, 0x64625c, 3));
  const key = new T.DirectionalLight(0xfff2e4, 4);
  key.position.set(-3, 6, 5);
  scene.add(key);
  const rim = new T.DirectionalLight(0xc4e0ff, 3);
  rim.position.set(3, 4, -3);
  scene.add(rim);
  const model = buildChimney();
  scene.add(model.root);
  let time = 0,
    playing = !reduced.matches,
    visible = false,
    disposed = false,
    lost = false,
    raf = 0,
    last = 0,
    lastStatus = -1;
  const frameInterval = 1000 / (mobile ? 30 : 45);
  function publish(force = false) {
    const tick = Math.floor(time * 5);
    if (force || tick !== lastStatus) {
      lastStatus = tick;
      onStatus({ time, playing, stage: stageAt(time) });
    }
  }
  function pose() {
    model.pose(time);
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
    camera.position.set(8, 6.3, 10);
    controls.target.set(0, 3.15, -0.8);
    controls.update();
    draw();
  }
  function moveCamera(direction: number) {
    // Translate camera and orbit target together, preserving viewing angle and zoom.
    const height = clamp(controls.target.y + direction * 0.2, 0.2, 7);
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
