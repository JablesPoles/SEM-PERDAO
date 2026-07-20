'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { playSound } from '../../lib/sounds';
import type {
  CultistAppearance,
  LobbyPlayer,
  LobbyRules,
} from '../../lib/types';
import {
  ACCENT_COLORS,
  ACCESSORY_MARKS,
  FACE_MARKS,
  ROBE_COLORS,
} from '../../lib/aparencia';
import { CultistStage3D } from '../CultistStage3D';
import styles from './RitualLobby.module.css';

interface RitualLobbyProps {
  roomCode: string;
  roomUrl: string;
  players: LobbyPlayer[];
  myPlayerId: number | null;
  hostId: number;
  isHost: boolean;
  rules: LobbyRules;
  countdownEndsAt: number | null;
  maxPlayers: number;
  minPlayers: number;
  customCardCount: number;
  onReadyChange: (ready: boolean) => void;
  onRulesChange: (rules: Partial<LobbyRules>) => void;
  onAddBot: () => void;
  onRemoveBot: (playerId: number) => void;
  onKickPlayer: (playerId: number) => void;
  onOpenDeck: () => void;
  onLeave: () => void;
}

// Catálogo e cores vêm de lib/aparencia — mesma fonte do menu, sem drift.

const PACE_PRESETS: Array<{
  label: string;
  description: string;
  values: Pick<LobbyRules, 'submitSeconds' | 'judgeSeconds' | 'resultSeconds'>;
}> = [
  {
    label: 'Relâmpago',
    description: '45s · 30s',
    values: { submitSeconds: 45, judgeSeconds: 30, resultSeconds: 7 },
  },
  {
    label: 'Ritual',
    description: '75s · 60s',
    values: { submitSeconds: 75, judgeSeconds: 60, resultSeconds: 9 },
  },
  {
    label: 'Tortura',
    description: '105s · 75s',
    values: { submitSeconds: 105, judgeSeconds: 75, resultSeconds: 12 },
  },
];

function cultistStyle(appearance: CultistAppearance): CSSProperties {
  const [robe, robeDark] = ROBE_COLORS[appearance.robe];
  return {
    '--robe': robe,
    '--robe-dark': robeDark,
    '--accent': ACCENT_COLORS[appearance.accent],
  } as CSSProperties;
}

function CultistPreview({
  appearance,
  name,
  mini = false,
}: {
  appearance: CultistAppearance;
  name?: string;
  mini?: boolean;
}) {
  return (
    <div
      className={`${styles.cultist} ${mini ? styles.cultistMini : ''}`}
      style={cultistStyle(appearance)}
      aria-hidden="true"
    >
      <div className={styles.robe} />
      <div className={`${styles.hood} ${styles[`hood_${appearance.hood}`]}`} />
      <div className={`${styles.face} ${styles[`face_${appearance.face}`]}`}>
        <span className={styles.faceMark}>{FACE_MARKS[appearance.face]}</span>
      </div>
      <span className={styles.accessory}>{ACCESSORY_MARKS[appearance.accessory]}</span>
      {!mini && name && <span className={styles.namePlate}>{name}</span>}
    </div>
  );
}

function samePace(
  rules: LobbyRules,
  preset: (typeof PACE_PRESETS)[number]
): boolean {
  return rules.submitSeconds === preset.values.submitSeconds
    && rules.judgeSeconds === preset.values.judgeSeconds
    && rules.resultSeconds === preset.values.resultSeconds;
}

export function RitualLobby({
  roomCode,
  roomUrl,
  players,
  myPlayerId,
  hostId,
  isHost,
  rules,
  countdownEndsAt,
  maxPlayers,
  minPlayers,
  customCardCount,
  onReadyChange,
  onRulesChange,
  onAddBot,
  onRemoveBot,
  onKickPlayer,
  onOpenDeck,
  onLeave,
}: RitualLobbyProps) {
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const lastCountdownCue = useRef<number | null>(null);

  useEffect(() => {
    if (countdownEndsAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [countdownEndsAt]);

  const me = players.find((player) => player.id === myPlayerId) ?? null;
  const botCount = players.filter((player) => player.isBot).length;
  const humanPlayers = players.filter((player) => !player.isBot);
  const readyHumans = humanPlayers.filter((player) => player.ready).length;
  const playerCountValid = players.length >= minPlayers && players.length <= maxPlayers;
  const waitingFor = humanPlayers.filter((player) => !player.ready).map((player) => player.name);
  const countdown = countdownEndsAt === null
    ? null
    : Math.max(0, Math.ceil((countdownEndsAt - now) / 1000));

  useEffect(() => {
    if (countdown === null) {
      lastCountdownCue.current = null;
      return;
    }
    if (countdown > 0 && countdown !== lastCountdownCue.current) {
      lastCountdownCue.current = countdown;
      playSound('countdown');
    }
  }, [countdown]);

  const readyHint = useMemo(() => {
    if (players.length < minPlayers) {
      const missing = minPlayers - players.length;
      return `Faltam ${missing} lugar${missing === 1 ? '' : 'es'} para formar o tribunal.`;
    }
    if (players.length > maxPlayers) return 'Há lugares demais neste snapshot antigo. O host precisa remover alguém.';
    if (waitingFor.length === 0) return 'Todos os selos estão acesos. O ritual vai começar.';
    if (waitingFor.length <= 2) return `Esperando ${waitingFor.join(' e ')} acender o selo.`;
    return `Esperando ${waitingFor.length} réus acenderem o selo.`;
  }, [maxPlayers, minPlayers, players.length, waitingFor]);

  const copyRoom = () => {
    void navigator.clipboard.writeText(roomUrl).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <main className={styles.shell}>
      <div className={styles.layout}>
        <header className={styles.masthead}>
          <div className={styles.brand}>SEM<br />PERDÃO<em>*</em></div>
          <div className={styles.roomSeal}>
            <div className={styles.roomCode}>
              <span className={styles.eyebrow}>código do tribunal</span>
              <span className={styles.code}>{roomCode}</span>
            </div>
            <button type="button" className={styles.copyButton} onClick={copyRoom}>
              {copied ? 'Copiado' : 'Copiar convite'}
            </button>
          </div>
          <button type="button" className={styles.leaveButton} onClick={onLeave}>Abandonar mesa</button>
        </header>

        <div className={styles.grid}>
          <div className={styles.column}>
            <section className={styles.panel} aria-labelledby="cultista-title">
              <div className={styles.panelHeader}>
                <h2 id="cultista-title" className={styles.panelTitle}>Seu réu</h2>
                <span className={styles.panelMeta}>trancado para a sessão</span>
              </div>
              <div className={styles.previewStage}>
                {me && (
                  <CultistStage3D
                    nome={me.name}
                    aparencia={me.appearance}
                    celebrarSinal={me.ready ? 1 : 0}
                    className={styles.previewCanvas}
                  />
                )}
              </div>
              {me && (
                <p className={styles.lockedNote}>
                  Seu réu entrou na sala como está. Pra trocar robe, capuz ou
                  sigilo, volte ao <strong>menu inicial</strong> antes de sentar
                  na mesa.
                </p>
              )}
            </section>
          </div>

          <div className={styles.column}>
            <section className={styles.panel} aria-labelledby="roster-title">
              <div className={styles.panelHeader}>
                <h2 id="roster-title" className={styles.panelTitle}>Banco dos réus</h2>
                <span className={styles.panelMeta}>{players.length}/{maxPlayers} · {readyHumans}/{humanPlayers.length} prontos</span>
              </div>
              <div className={styles.roster}>
                {players.map((player) => (
                  <article
                    key={player.id}
                    className={`${styles.player} ${player.id === myPlayerId ? styles.playerMine : ''} ${player.ready ? styles.playerReady : ''}`}
                  >
                    <CultistPreview appearance={player.appearance} mini />
                    <div className={styles.playerText}>
                      <span className={styles.playerName}>
                        {player.name}{player.id === hostId ? ' · HOST' : ''}
                      </span>
                      <span className={styles.playerState}>
                        {player.isBot ? 'autômato · pronto' : player.ready ? 'selo aceso' : 'preparando ritual'}
                      </span>
                    </div>
                    <span
                      className={`${styles.candle} ${player.ready ? styles.candleLit : ''}`}
                      title={player.ready ? 'Pronto' : 'Ainda não está pronto'}
                    />
                    {isHost && player.id !== myPlayerId && (
                      <button
                        type="button"
                        className={styles.removeButton}
                        aria-label={`Remover ${player.name}`}
                        title={`Remover ${player.name}`}
                        onClick={() => player.isBot ? onRemoveBot(player.id) : onKickPlayer(player.id)}
                      >
                        ×
                      </button>
                    )}
                  </article>
                ))}

                {players.length < minPlayers && (
                  <div className={styles.emptySeat}>aguardando outra alma…</div>
                )}
                {isHost && players.length < maxPlayers && botCount < 3 && (
                  <button type="button" className={styles.utilityButton} onClick={onAddBot}>
                    + invocar autômato
                  </button>
                )}
                {isHost && (
                  <button type="button" className={styles.utilityButton} onClick={onOpenDeck}>
                    baralho · {customCardCount ? `${customCardCount} próprias` : 'padrão'}
                  </button>
                )}
              </div>
            </section>

            <section className={styles.panel} aria-labelledby="rules-title">
              <div className={styles.panelHeader}>
                <h2 id="rules-title" className={styles.panelTitle}>Termos da sentença</h2>
                <span className={styles.panelMeta}>{isHost ? 'você dita as regras' : 'ditadas pelo host'}</span>
              </div>

              <div className={styles.rules}>
                {isHost ? (
                  <>
                    <div>
                      <div className={styles.ruleLabel}>
                        <strong>Quem decide</strong>
                        <span>alterar apaga todos os selos</span>
                      </div>
                      <div className={styles.segmented} style={{ '--segments': 2 } as CSSProperties}>
                        {([
                          ['judge', '1 juiz', 'um martelo por rodada'],
                          ['democracy', 'democracia', 'todos jogam e votam'],
                        ] as const).map(([value, label, description]) => (
                          <button
                            type="button"
                            key={value}
                            className={`${styles.segment} ${rules.mode === value ? styles.segmentSelected : ''}`}
                            aria-pressed={rules.mode === value}
                            onClick={() => onRulesChange({ mode: value })}
                          >
                            {label}<small>{description}</small>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className={styles.ruleLabel}>
                        <strong>Voltas completas</strong>
                        <span>empate abre morte súbita</span>
                      </div>
                      <div className={styles.segmented} style={{ '--segments': 3 } as CSSProperties}>
                        {([1, 2, 3] as const).map((turnLimit) => (
                          <button
                            type="button"
                            key={turnLimit}
                            className={`${styles.segment} ${rules.turnLimit === turnLimit ? styles.segmentSelected : ''}`}
                            aria-pressed={rules.turnLimit === turnLimit}
                            onClick={() => onRulesChange({ turnLimit })}
                          >
                            {turnLimit} volta{turnLimit > 1 ? 's' : ''}
                            <small>{players.length * turnLimit} rodadas</small>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className={styles.ruleLabel}>
                        <strong>Ritmo da mesa</strong>
                        <span>jogada · julgamento</span>
                      </div>
                      <div className={styles.segmented} style={{ '--segments': 3 } as CSSProperties}>
                        {PACE_PRESETS.map((preset) => {
                          const selected = samePace(rules, preset);
                          return (
                            <button
                              type="button"
                              key={preset.label}
                              className={`${styles.segment} ${selected ? styles.segmentSelected : ''}`}
                              aria-pressed={selected}
                              onClick={() => onRulesChange(preset.values)}
                            >
                              {preset.label}<small>{preset.description}</small>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className={styles.guestRules} aria-label="Regras escolhidas pelo host">
                    <div className={styles.ruleSummary}>
                      <strong>{rules.mode === 'judge' ? '1' : 'TODOS'}</strong>
                      <span>{rules.mode === 'judge' ? 'juiz' : 'votam'}</span>
                    </div>
                    <div className={styles.ruleSummary}>
                      <strong>{rules.turnLimit}</strong>
                      <span>volta{rules.turnLimit > 1 ? 's' : ''}</span>
                    </div>
                    <div className={styles.ruleSummary}>
                      <strong>{rules.submitSeconds}s</strong>
                      <span>para jogar</span>
                    </div>
                  </div>
                )}
              </div>

              <div className={styles.readyArea}>
                <button
                  type="button"
                  className={`${styles.readyButton} ${me?.ready ? styles.readyButtonOn : ''}`}
                  disabled={!me || me.isBot || !playerCountValid}
                  aria-pressed={me?.ready ?? false}
                  onClick={() => me && onReadyChange(!me.ready)}
                >
                  {me?.ready ? 'APAGAR MEU SELO' : 'ACENDER MEU SELO'}
                </button>
                <p className={styles.readyHint} role="status" aria-live="polite">
                  {me?.ready && waitingFor.length > 0 && <strong>Você está pronto. </strong>}
                  {readyHint}
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>

      {countdown !== null && (
        <div className={styles.countdown} role="alert" aria-live="assertive">
          <div className={styles.countdownContent}>
            <span className={styles.countdownNumber}>{countdown || '†'}</span>
            <span className={styles.countdownLabel}>
              {countdown ? 'ninguém abandona o círculo' : 'abrindo o tribunal'}
            </span>
          </div>
        </div>
      )}
    </main>
  );
}
