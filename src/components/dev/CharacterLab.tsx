'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ACTOR_EXPRESSIONS,
  ACTOR_INTENTS,
  type ActorExpression,
  type ActorIntent,
} from '@/lib/mesa/actorContract';
import {
  APPEARANCE_GROUPS,
  aparenciaAleatoria,
} from '@/lib/aparencia';
import { DEFAULT_CULTIST_APPEARANCE, type CultistAppearance } from '@/lib/types';
import { CHARACTER_ACTOR_CATALOG } from '@/lib/three/actors/characterActorCatalog';
import type { FrameBenchmarkResult } from '@/lib/three/frameBenchmark';
import type {
  CharacterLabCamera,
  CharacterLabScene,
  CharacterLabSnapshot,
  CharacterLabTrace,
} from '@/lib/three/characterLabScene';
import type { StageQuality } from '@/lib/three/tabletopStage';
import styles from './CharacterLab.module.css';

const INTENT_LABELS: Record<ActorIntent, string> = {
  idle: 'Repouso',
  speak: 'Falar',
  laugh: 'Rir',
  point: 'Apontar',
  clap: 'Aplaudir',
  celebrate: 'Celebrar',
  facepalm: 'Facepalm',
  hit: 'Impacto',
  rage: 'Tilt',
  sleep: 'Dormir',
  collapse: 'Tombar',
};

const EXPRESSION_LABELS: Record<ActorExpression, string> = {
  neutral: 'Neutro',
  joy: 'Riso',
  shock: 'Choque',
  contempt: 'Desprezo',
  sleep: 'Sono',
};

const CAMERA_LABELS: Record<CharacterLabCamera, string> = {
  full: 'Corpo',
  face: 'Rosto',
  profile: 'Perfil',
};

const QUALITY_LABELS: Record<StageQuality, string> = {
  cinematic: 'Cinema',
  balanced: 'Equilíbrio',
  performance: 'Leve',
};

function hasOwn<T extends object>(value: string | null, record: T): value is Extract<keyof T, string> {
  return value !== null && Object.prototype.hasOwnProperty.call(record, value);
}

function number(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toLocaleString('pt-BR') : '—';
}

function Metric({ label, value, warning = false, note }: {
  label: string;
  value: string | number;
  warning?: boolean;
  note?: string;
}) {
  return (
    <div className={`${styles.metric} ${warning ? styles.metricWarning : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note && <small>{note}</small>}
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    try {
      return document.execCommand('copy');
    } finally {
      field.remove();
    }
  }
}

export function CharacterLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<CharacterLabScene | null>(null);
  const actorSpecRef = useRef({
    name: 'RÉU TESTE',
    appearance: DEFAULT_CULTIST_APPEARANCE,
    key: `RÉU TESTE:${JSON.stringify(DEFAULT_CULTIST_APPEARANCE)}`,
  });
  const appliedActorKeyRef = useRef('');
  const [name, setName] = useState('RÉU TESTE');
  const [appearance, setAppearance] = useState<CultistAppearance>(DEFAULT_CULTIST_APPEARANCE);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<CharacterLabSnapshot | null>(null);
  const [traces, setTraces] = useState<CharacterLabTrace[]>([]);
  const [camera, setCamera] = useState<CharacterLabCamera>('full');
  const [quality, setQuality] = useState<StageQuality>('balanced');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [benchmarking, setBenchmarking] = useState(false);
  const [benchmark, setBenchmark] = useState<FrameBenchmarkResult | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [captureReady, setCaptureReady] = useState(false);
  const [selectedActorId, setSelectedActorId] = useState(CHARACTER_ACTOR_CATALOG.defaultActorId);
  const [actorSourceLoading, setActorSourceLoading] = useState(false);

  const appearanceKey = useMemo(() => JSON.stringify(appearance), [appearance]);
  const actorKey = `${name}:${appearanceKey}`;

  useEffect(() => {
    let active = true;
    let metricsTimer: ReturnType<typeof setInterval> | null = null;
    (async () => {
      try {
        await document.fonts.ready;
        if (!active || !canvasRef.current) return;
        const { CharacterLabScene } = await import('@/lib/three/characterLabScene');
        if (!active || !canvasRef.current) return;
        const current = actorSpecRef.current;
        const scene = new CharacterLabScene(canvasRef.current, {
          name: current.name,
          appearance: current.appearance,
          onTrace: (trace) => {
            if (active) setTraces((entries) => [trace, ...entries].slice(0, 8));
          },
        });
        sceneRef.current = scene;
        appliedActorKeyRef.current = current.key;
        setSnapshot(scene.snapshot());
        setStatus('ready');
        metricsTimer = setInterval(() => {
          if (active && sceneRef.current) setSnapshot(sceneRef.current.snapshot());
        }, 500);
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o palco WebGL.');
        setStatus('error');
      }
    })();
    return () => {
      active = false;
      if (metricsTimer) clearInterval(metricsTimer);
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    actorSpecRef.current = { name, appearance, key: actorKey };
    const timer = setTimeout(() => {
      if (!sceneRef.current || appliedActorKeyRef.current === actorKey) return;
      sceneRef.current.setActor(name, appearance);
      appliedActorKeyRef.current = actorKey;
    }, 120);
    return () => clearTimeout(timer);
  }, [name, appearance, appearanceKey, actorKey]);

  useEffect(() => {
    if (status !== 'ready' || !sceneRef.current) return;
    const scene = sceneRef.current;
    const params = new URLSearchParams(window.location.search);
    const requestedCamera = params.get('camera');
    const requestedQuality = params.get('quality');
    const requestedExpression = params.get('expression');
    const wantsReducedMotion = params.get('reducedMotion') === '1';

    if (hasOwn(requestedCamera, CAMERA_LABELS)) {
      scene.setCamera(requestedCamera, { immediate: true });
    }
    if (hasOwn(requestedQuality, QUALITY_LABELS)) {
      scene.setQuality(requestedQuality);
    }
    if (requestedExpression && ACTOR_EXPRESSIONS.includes(requestedExpression as ActorExpression)) {
      scene.setExpression(requestedExpression as ActorExpression);
    }
    if (wantsReducedMotion) {
      scene.setReducedMotion(true);
    }

    const timer = window.setTimeout(() => {
      if (hasOwn(requestedCamera, CAMERA_LABELS)) setCamera(requestedCamera);
      if (hasOwn(requestedQuality, QUALITY_LABELS)) setQuality(requestedQuality);
      if (wantsReducedMotion) setReducedMotion(true);
      if (sceneRef.current === scene) setSnapshot(scene.snapshot());
      setCaptureReady(true);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [status]);

  const chooseAppearance = (key: keyof CultistAppearance, value: string) => {
    setAppearance((current) => ({ ...current, [key]: value } as CultistAppearance));
  };

  const chooseActorSource = async (actorId: string) => {
    const scene = sceneRef.current;
    if (!scene || actorSourceLoading) return;
    setSelectedActorId(actorId);
    setActorSourceLoading(true);
    try {
      await scene.setActorSource(actorId, name, appearance);
      if (sceneRef.current === scene) setSnapshot(scene.snapshot());
    } finally {
      if (sceneRef.current === scene) setActorSourceLoading(false);
    }
  };

  const play = (intent: ActorIntent) => {
    sceneRef.current?.emitIntent(intent);
  };

  const expression = (value: ActorExpression) => {
    sceneRef.current?.setExpression(value);
  };

  const chooseCamera = (value: CharacterLabCamera) => {
    setCamera(value);
    sceneRef.current?.setCamera(value);
  };

  const chooseQuality = (value: StageQuality) => {
    setQuality(value);
    sceneRef.current?.setQuality(value);
  };

  const toggleMotion = () => {
    setReducedMotion((current) => {
      sceneRef.current?.setReducedMotion(!current);
      return !current;
    });
  };

  const runBenchmark = async () => {
    if (!sceneRef.current || benchmarking) return;
    setBenchmarking(true);
    setBenchmark(null);
    try {
      setBenchmark(await sceneRef.current.benchmark());
    } finally {
      setBenchmarking(false);
    }
  };

  const copyReport = async () => {
    if (!snapshot) return;
    const report = {
      generatedAt: new Date().toISOString(),
      actor: { name, appearance },
      quality,
      snapshot,
      benchmark,
      events: traces.map(({ event, beats }) => ({ event, beats })),
    };
    const success = await copyText(JSON.stringify(report, null, 2));
    setCopyStatus(success ? 'copied' : 'error');
    setTimeout(() => setCopyStatus('idle'), 1_600);
  };

  const hasBudgetProblem = Boolean(snapshot?.budgetIssues.some((issue) => issue.severity === 'error'));
  const framing = snapshot?.framing ?? null;
  const intentionalCrop = snapshot?.camera !== undefined && snapshot.camera !== 'full';
  const framingWarning = Boolean(framing && !framing.fits && !intentionalCrop);
  const framingValue = !framing
    ? '—'
    : framing.fits
      ? 'OK'
      : intentionalCrop
        ? 'RECORTE'
        : 'REVISAR';
  const framingNote = framing
    ? `X +${(framing.overflowX * 100).toFixed(1)}% · Y +${(framing.overflowY * 100).toFixed(1)}%`
    : undefined;

  return (
    <main className={styles.shell} data-capture-ready={captureReady ? 'true' : 'false'}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>A MESA ENGINE / DEV TOOL 01</span>
          <h1>CHARACTER LAB<span>*</span></h1>
          <p>Um ator, todos os contratos. Visual, animação e custo no mesmo lugar.</p>
        </div>
        <div className={styles.headerActions}>
          <span className={`${styles.status} ${styles[`status_${status}`]}`}>
            <i /> {status === 'ready' ? 'runtime pronto' : status === 'error' ? 'falhou' : 'iniciando'}
          </span>
          <Link href="/" className={styles.back}>← jogo</Link>
        </div>
      </header>

      <div className={styles.workspace}>
        <section
          className={styles.stagePanel}
          aria-label="Palco de validação do personagem"
          data-capture-target="stage"
        >
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            data-testid="character-lab-canvas"
            aria-label="Cultista renderizado em 3D"
          />
          <div className={styles.scanlines} aria-hidden="true" />
          <div className={styles.stageTopline}>
            <span>
              {snapshot
                ? `${snapshot.actorSource.runtime.toUpperCase()} / ${snapshot.actorSource.activeId}`
                : 'ATOR / CARREGANDO'}
            </span>
            <span>{snapshot?.stage.viewportMode?.toUpperCase() ?? '—'}</span>
          </div>
          <div className={styles.stageHint}>ARRASTE PARA ORBITAR · SCROLL PARA ZOOM · CLIQUE NO RÉU</div>
          {status !== 'ready' && (
            <div className={styles.stageStatus} role="status">
              <strong>{status === 'error' ? 'PALCO INDISPONÍVEL' : 'ACENDENDO O PORÃO'}</strong>
              <span>{status === 'error' ? error : 'compilando shaders e montando o ator'}</span>
            </div>
          )}
        </section>

        <aside
          className={styles.controls}
          aria-label="Controles do Character Lab"
          data-capture-target="controls"
        >
          <section className={styles.panel}>
            <div className={styles.panelHeading}>
              <h2>Fonte do ator</h2>
              <span>{actorSourceLoading ? 'carregando…' : `${CHARACTER_ACTOR_CATALOG.entries.length} registradas`}</span>
            </div>
            <div className={styles.actorSources}>
              {CHARACTER_ACTOR_CATALOG.entries.map((entry) => {
                const isSelected = selectedActorId === entry.id;
                const isActive = snapshot?.actorSource.activeId === entry.id;
                return (
                  <button
                    type="button"
                    key={entry.id}
                    aria-pressed={isSelected}
                    disabled={status !== 'ready' || actorSourceLoading}
                    onClick={() => void chooseActorSource(entry.id)}
                  >
                    <span>
                      <strong>{entry.label}</strong>
                      <small>{entry.runtime} · {entry.availability === 'bundled' ? 'incluído' : 'sob demanda'}</small>
                    </span>
                    <i data-active={isActive ? 'true' : 'false'}>{isActive ? 'ATIVO' : 'TESTAR'}</i>
                  </button>
                );
              })}
            </div>
            {snapshot?.actorSource.detail && (
              <p
                className={`${styles.actorSourceNotice} ${styles[`actorSource_${snapshot.actorSource.status}`]}`}
                role="status"
              >
                {snapshot.actorSource.status === 'fallback' ? 'FALLBACK ATIVO · ' : ''}
                {snapshot.actorSource.detail}
              </p>
            )}
            <code className={styles.actorSourceUri}>
              {snapshot?.actorSource.manifestUrl ?? snapshot?.actorSource.manifestUri ?? '—'}
            </code>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeading}>
              <h2>Identidade</h2>
              <button type="button" onClick={() => setAppearance(aparenciaAleatoria())}>sortear</button>
            </div>
            <label className={styles.textField}>
              <span>Nome no crachá</span>
              <input value={name} maxLength={16} onChange={(event) => setName(event.target.value)} />
            </label>
            <div className={styles.appearanceGroups}>
              {APPEARANCE_GROUPS.map((group) => (
                <label key={group.key}>
                  <span>{group.label}</span>
                  <select
                    value={appearance[group.key]}
                    onChange={(event) => chooseAppearance(group.key, event.target.value)}
                  >
                    {group.options.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeading}>
              <h2>Intenções</h2>
              <span>evento → diretor → ator</span>
            </div>
            <div className={styles.buttonGrid}>
              {ACTOR_INTENTS.map((intent) => (
                <button
                  type="button"
                  key={intent}
                  onClick={() => play(intent)}
                  disabled={status !== 'ready'}
                  data-testid={`intent-${intent}`}
                  className={intent === 'hit' || intent === 'rage' ? styles.dangerButton : ''}
                >
                  {INTENT_LABELS[intent]}
                </button>
              ))}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeading}><h2>Expressão</h2><span>rosto semântico</span></div>
            <div className={styles.segmented}>
              {ACTOR_EXPRESSIONS.map((value) => (
                <button type="button" key={value} onClick={() => expression(value)}>
                  {EXPRESSION_LABELS[value]}
                </button>
              ))}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeading}><h2>Palco</h2><span>câmera e custo</span></div>
            <div className={styles.controlRow}>
              <span>Câmera</span>
              <div className={styles.segmented}>
                {(Object.keys(CAMERA_LABELS) as CharacterLabCamera[]).map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={camera === value}
                    onClick={() => chooseCamera(value)}
                  >
                    {CAMERA_LABELS[value]}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.controlRow}>
              <span>Qualidade</span>
              <div className={styles.segmented}>
                {(Object.keys(QUALITY_LABELS) as StageQuality[]).map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={quality === value}
                    onClick={() => chooseQuality(value)}
                  >
                    {QUALITY_LABELS[value]}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              className={styles.switch}
              aria-pressed={reducedMotion}
              onClick={toggleMotion}
            >
              <i /> Movimento reduzido
            </button>
          </section>
        </aside>
      </div>

      <section
        className={styles.telemetry}
        aria-label="Telemetria do ator e do palco"
        data-capture-target="telemetry"
      >
        <div className={styles.telemetryHeader}>
          <div>
            <span className={styles.kicker}>TELEMETRIA AO VIVO</span>
            <h2>O modelo entra se couber no orçamento.</h2>
          </div>
          <div className={styles.telemetryActions}>
            <button type="button" onClick={runBenchmark} disabled={benchmarking || status !== 'ready'}>
              {benchmarking ? 'medindo 4s…' : 'rodar benchmark'}
            </button>
            <button type="button" onClick={copyReport} disabled={!snapshot}>
              {copyStatus === 'copied'
                ? 'copiado!'
                : copyStatus === 'error'
                  ? 'clipboard bloqueado'
                  : 'copiar relatório'}
            </button>
          </div>
        </div>

        <div className={styles.telemetryGrid}>
          <dl className={styles.metrics}>
            <Metric label="FPS médio" value={benchmark ? number(benchmark.averageFps) : 'benchmark'} />
            <Metric label="P95 frame" value={benchmark ? `${number(benchmark.p95FrameMs)} ms` : '—'} />
            <Metric label="Draw calls palco" value={number(snapshot?.stage.drawCalls)} />
            <Metric label="Triângulos ator" value={number(snapshot?.actor.triangles)} warning={hasBudgetProblem} />
            <Metric label="Draw calls ator" value={number(snapshot?.actor.drawCalls)} warning={hasBudgetProblem} />
            <Metric label="Materiais" value={number(snapshot?.actor.materials)} />
            <Metric label="Texturas GPU" value={number(snapshot?.stage.textures)} />
            <Metric label="Geometrias GPU" value={number(snapshot?.stage.geometries)} />
            <Metric
              label={`Enquadramento · ${CAMERA_LABELS[snapshot?.camera ?? camera]}`}
              value={framingValue}
              warning={framingWarning}
              note={framingNote}
            />
            <Metric label="Viewport render" value={snapshot ? `${snapshot.stage.renderWidth}×${snapshot.stage.renderHeight}` : '—'} />
          </dl>

          <div className={styles.audit}>
            <div className={styles.auditTitle}>
              <span>MANIFEST AUDIT</span>
              <strong className={hasBudgetProblem ? styles.bad : styles.good}>
                {hasBudgetProblem ? 'FORA DO BUDGET' : 'APROVADO'}
              </strong>
            </div>
            <code>a-mesa.actor/v1 · {snapshot?.actorSource.activeId ?? '—'}</code>
            <p>
              {snapshot?.budgetIssues.length
                ? snapshot.budgetIssues.map((issue) => issue.message).join(' · ')
                : snapshot?.actorSource.status === 'fallback'
                  ? snapshot.actorSource.detail
                  : 'Âncoras, custo e contrato semântico aprovados para a fonte ativa.'}
            </p>
            <div className={styles.anchorList}>
              {Object.entries(snapshot?.anchors ?? {}).map(([id, position]) => (
                <span key={id}>{id}: [{position.map((value) => value.toFixed(2)).join(', ')}]</span>
              ))}
            </div>
          </div>

          <div className={styles.eventLog}>
            <div className={styles.auditTitle}><span>EVENT JOURNAL</span><strong>{traces.length}/8</strong></div>
            {traces.length === 0 ? (
              <p>Dispare uma intenção para inspecionar o contrato.</p>
            ) : traces.map(({ event, beats }) => (
              <div key={event.id} className={styles.eventRow}>
                <span>#{event.sequence}</span>
                <strong>{String(event.payload.intent)}</strong>
                <small>{beats.map((beat) => beat.channel).join(' + ')}</small>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
