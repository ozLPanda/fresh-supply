import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  MoveUpRight,
  Pause,
  Play,
  RotateCcw,
  Scan,
  Flame,
} from "lucide-react";
import { AppButton } from "@/shared/ui/AppButton";
import { SeoMeta } from "@/shared/seo/SeoMeta";
import * as boilerTimeline from "./timeline";
import * as chimneyTimeline from "./chimneyTimeline";
import type { BoilerScene, SceneStatus } from "./createBoilerScene";
import "./Kotel3DPage.css";

export default function Kotel3DPage() {
  const [scene, setScene] = useState<"boiler" | "chimney">("boiler");
  const { DURATION, stages } = scene === "boiler" ? boilerTimeline : chimneyTimeline;
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<BoilerScene | null>(null);
  const [status, setStatus] = useState<SceneStatus>({ time: 0, playing: false, stage: 0 });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const element = host.current!;
    setReady(false);
    setError(false);
    setStatus({ time: 0, playing: false, stage: 0 });
    const factory =
      scene === "boiler"
        ? import("./createBoilerScene").then((m) => m.createBoilerScene)
        : import("./createChimneyScene").then((m) => m.createChimneyScene);
    factory
      .then((createScene) => {
        if (cancelled) return;
        engine.current = createScene(element, setStatus, () => setError(true));
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
      engine.current?.dispose();
      engine.current = null;
    };
  }, [attempt, scene]);
  const enabled = ready && !error;
  return (
    <main className="kotel-page">
      <SeoMeta
        title="Котёл Горняк — интерактивная 3D-модель"
        description="Рассмотрите котёл Горняк в 3D: открытие дверцы, загрузка угля и визуализация горения."
        canonicalPath="/kotel3d"
        robots="noindex,nofollow"
      />
      <div className="kotel-page__top">
        <Link to="/main2">
          <ArrowLeft size={16} /> В магазин
        </Link>
        <span>ОБОРУДОВАНИЕ В ДЕТАЛЯХ</span>
      </div>
      <div className="kotel-workspace">
        <nav className="kotel-scenes" aria-label="Выбор сцены">
          <span className="kotel-scenes__label">СЦЕНЫ</span>
          <AppButton
            variant="ghost"
            aria-pressed={scene === "boiler"}
            onClick={() => setScene("boiler")}
          >
            <span className="kotel-scenes__number">01</span>
            <span>
              Пользование котлом<small>От загрузки до очистки</small>
            </span>
          </AppButton>
          <AppButton
            variant="ghost"
            aria-pressed={scene === "chimney"}
            onClick={() => setScene("chimney")}
          >
            <span className="kotel-scenes__number">02</span>
            <span>
              Монтаж дымохода<small>От котла до крыши</small>
            </span>
          </AppButton>
        </nav>
        <section className="kotel-viewer" aria-label="Интерактивная демонстрация котла">
          <header className="kotel-viewer__header">
            <div className="kotel-viewer__identity">
              <span className="kotel-viewer__brand">
                <Flame size={22} />
              </span>
              <div>
                <h1>Горняк</h1>
                <p>
                  {scene === "boiler"
                    ? "Пользование котлом"
                    : "Монтаж дымохода · помещение в разрезе"}
                </p>
              </div>
            </div>
            <span className="kotel-viewer__badge">
              3D <span> / </span> ОБЗОР
            </span>
          </header>
          <div className="kotel-viewer__stage">
            <div className="kotel-viewer__canvas" ref={host} />
            {(!ready || error) && (
              <div className="kotel-viewer__fallback">
                <img
                  src="/models/gornyak-reference.png"
                  alt="Котёл Горняк на фотографии производителя"
                />
                <div role="status">
                  {error ? "Не удалось запустить 3D-просмотр." : "Подготавливаем 3D-модель…"}
                  {error && (
                    <AppButton variant="secondary" onClick={() => setAttempt((v) => v + 1)}>
                      Попробовать снова
                    </AppButton>
                  )}
                </div>
              </div>
            )}
            {enabled && (
              <>
                <div className="kotel-viewer__caption">
                  <span>
                    0{status.stage + 1} /{" "}
                    {scene === "boiler" ? "УСТРОЙСТВО КОТЛА" : "МОНТАЖ ДЫМОХОДА"}
                  </span>
                  <h2>{stages[status.stage].title}</h2>
                  <p>{stages[status.stage].text}</p>
                </div>
                <div className="kotel-viewer__view" role="group" aria-label="Положение камеры">
                  <AppButton
                    variant="secondary"
                    onClick={() => engine.current?.moveCamera(1)}
                    title="Поднять камеру"
                    aria-label="Поднять камеру"
                  >
                    <ArrowUp size={17} />
                  </AppButton>
                  <AppButton
                    variant="secondary"
                    onClick={() => engine.current?.moveCamera(-1)}
                    title="Опустить камеру"
                    aria-label="Опустить камеру"
                  >
                    <ArrowDown size={17} />
                  </AppButton>
                  <AppButton
                    variant="secondary"
                    onClick={() => engine.current?.resetView()}
                    title="Вернуть исходный ракурс"
                    aria-label="Вернуть исходный ракурс"
                  >
                    <Scan size={17} />
                  </AppButton>
                </div>
                <span className="kotel-viewer__gesture">
                  <MoveUpRight size={13} /> Трекпад: ↕ высота • ↔ поворот • щипок — зум
                </span>
              </>
            )}
          </div>
          <footer className="kotel-viewer__footer">
            <div className="kotel-viewer__timeline">
              <label className="kotel-viewer__sr" htmlFor="kotel-progress">
                Ход демонстрации
              </label>
              <input
                id="kotel-progress"
                type="range"
                min="0"
                max={DURATION}
                step="0.05"
                value={status.time}
                disabled={!enabled}
                onChange={(e) => {
                  engine.current?.pause();
                  engine.current?.seek(Number(e.target.value));
                }}
                aria-valuetext={`${Math.floor(status.time)} из ${DURATION} секунд`}
              />
            </div>
            <div className="kotel-viewer__controls">
              <div className="kotel-viewer__play">
                <AppButton
                  disabled={!enabled}
                  onClick={() =>
                    status.playing ? engine.current?.pause() : engine.current?.play()
                  }
                  aria-label={
                    status.playing ? "Приостановить демонстрацию" : "Воспроизвести демонстрацию"
                  }
                >
                  {status.playing ? <Pause size={17} /> : <Play size={17} />}
                  <span>
                    {status.playing ? "Пауза" : status.time >= DURATION ? "Повторить" : "Смотреть"}
                  </span>
                </AppButton>
                <AppButton
                  variant="ghost"
                  disabled={!enabled}
                  onClick={() => {
                    engine.current?.pause();
                    engine.current?.seek(0);
                    engine.current?.resetView();
                  }}
                  aria-label="Сбросить демонстрацию"
                >
                  <RotateCcw size={17} />
                </AppButton>
              </div>
              <div className="kotel-viewer__steps" role="group" aria-label="Этапы демонстрации">
                {stages.map((stage, i) => (
                  <button
                    key={stage.title}
                    type="button"
                    disabled={!enabled}
                    aria-pressed={status.stage === i}
                    onClick={() => {
                      engine.current?.pause();
                      engine.current?.seek(stage.time);
                    }}
                  >
                    <span>0{i + 1}</span>
                    {stage.title}
                  </button>
                ))}
              </div>
            </div>
          </footer>
        </section>
      </div>
      <p className="kotel-page__note">
        Визуальная реконструкция по фотографиям. Пропорции приблизительные; сцена не является
        инструкцией по эксплуатации или монтажу. Размеры, отступы и узлы подбираются по документации
        оборудования.
      </p>
    </main>
  );
}
