import { useEffect, useMemo, useRef, useState } from 'react';
import Phaser from 'phaser';
import { CHAR_BY_ID } from '../game/characters';
import { Race } from '../game/sim/race';
import type { CharId, PublicRunner, RaceEvent } from '../game/types';
import { RaceScene, VIEW_H, VIEW_W } from '../scenes/RaceScene';
import { Avatar } from './Avatar';
import { type Comment, commentFor } from './commentary';
import { isMuted, setMuted, sfx } from './sound';
import { EFFECT_IMAGES, type StadiumTheme, assetUrl, uiUrl } from '../game/images';
import { UiImg } from './UiImg';

interface Cutin { id: number; actor: number; name: string; line: string }
interface Toast { id: number; text: string; color: string }
/** 이미지 배너 알림: skill=스킬 발동, overtake=선두 추월, first=1위 골인 */
interface Notice { id: number; kind: 'skill' | 'overtake' | 'first'; who: string; text: string; color: string }

const CUTIN_MS = 1600;

export function RaceScreen({ lineup, seed, theme, onDone, onExit }: {
  lineup: CharId[]; seed: number; theme: StadiumTheme; onDone: (race: Race) => void; onExit: () => void;
}) {
  const race = useMemo(() => new Race(lineup, seed), [lineup, seed]);
  const defs = useMemo(() => race.runners.map((r) => r.def), [race]);
  const hostRef = useRef<HTMLDivElement>(null);
  const speedRef = useRef(1);
  const [speed, setSpeed] = useState(1);
  const [muted, setMutedState] = useState(isMuted());
  const [pub, setPub] = useState<PublicRunner[]>([]);
  const [time, setTime] = useState(0);
  const [finishLine, setFinishLine] = useState(race.finishLine);
  const [count, setCount] = useState<number | null>(3);
  const [comments, setComments] = useState<Comment[]>([]);
  const [cutin, setCutin] = useState<Cutin | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [banner, setBanner] = useState<{ from: number; to: number } | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const lastSkillNotice = useRef(0);
  const firstShown = useRef(false);
  const [leaderFlash, setLeaderFlash] = useState(0);
  const idRef = useRef(1);
  const cutinBusy = useRef(false);
  const cutinQueue = useRef<Cutin[]>([]);
  const lastSfx = useRef<Record<string, number>>({});

  const play = (key: keyof typeof sfx, gap = 120) => {
    const now = performance.now();
    if (now - (lastSfx.current[key] ?? 0) < gap) return;
    lastSfx.current[key] = now;
    sfx[key]();
  };

  const showNextCutin = () => {
    const next = cutinQueue.current.shift();
    if (!next) { cutinBusy.current = false; setCutin(null); return; }
    cutinBusy.current = true;
    setCutin(next);
    setTimeout(showNextCutin, CUTIN_MS);
  };

  const pushToast = (text: string, color: string) => {
    const id = idRef.current++;
    setToasts((ts) => [...ts.slice(-3), { id, text, color }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 2600);
  };

  const pushNotice = (kind: Notice['kind'], actor: number, text: string, ms = 1800) => {
    const id = idRef.current++;
    const d = defs[actor];
    setNotices((ns) => [...ns.filter((x) => x.kind !== kind).slice(-1), { id, kind, who: d.name, text, color: d.color }]);
    setTimeout(() => setNotices((ns) => ns.filter((x) => x.id !== id)), ms);
  };

  const handleEvents = (evs: RaceEvent[]) => {
    const newComments: Comment[] = [];
    for (const e of evs) {
      const c = commentFor(e, defs);
      if (c) newComments.push({ ...c, id: idRef.current++ });
      switch (e.type) {
        case 'ult': {
          play('ult', 0);
          const d = defs[e.actor!];
          const ci: Cutin = { id: idRef.current++, actor: e.actor!, name: d.ult.name, line: d.ult.cutin };
          // 컷인은 1개씩 순서대로, 대기열이 차 있으면 작은 알림으로 대체 (화면 가림 방지)
          if (!cutinBusy.current) { cutinQueue.current.push(ci); showNextCutin(); }
          else if (cutinQueue.current.length < 1) cutinQueue.current.push(ci);
          else pushToast(`💥 ${d.name} [${d.ult.name}]`, d.color);
          break;
        }
        case 'skill': {
          play('skill');
          // 스킬은 자주 발동하므로 이미지 배너는 1.5초에 한 번만 (나머지는 중계·캐릭터 이펙트로 표시)
          const now = performance.now();
          if (now - lastSkillNotice.current > 1500) {
            lastSkillNotice.current = now;
            pushNotice('skill', e.actor!, `${e.skillName}${e.label ? ` · ${e.label}` : ''}`, 1400);
          }
          break;
        }
        case 'obstacleHit': play('hit'); break;
        case 'obstacleDodge': case 'obstacleImmune': play('dodge'); break;
        case 'debuff': case 'push': case 'swap': play('debuff'); break;
        case 'finish':
          play('finish', 60);
          if (!firstShown.current) { firstShown.current = true; pushNotice('first', e.actor!, `${e.value!.toFixed(3)}초 골인!`, 2600); }
          break;
        case 'cheer': play('cheer'); break;
        case 'leadChange': setLeaderFlash((x) => x + 1); pushNotice('overtake', e.actor!, '선두로 올라섭니다!'); break;
        case 'finishMove':
          play('finishMove', 0);
          setFinishLine(e.to!);
          setBanner({ from: e.from!, to: e.to! });
          setTimeout(() => setBanner(null), 2600);
          break;
      }
    }
    if (newComments.length) setComments((cs) => [...newComments.reverse(), ...cs].slice(0, 5));
  };

  // 최신 핸들러를 씬에서 사용하도록 ref 보관
  const handlerRef = useRef(handleEvents);
  handlerRef.current = handleEvents;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const scene = new RaceScene(race, {
      onCountdown: (n) => {
        setCount(n);
        if (n > 0) sfx.count(); else { sfx.go(); setTimeout(() => setCount(null), 700); }
      },
      onEvents: (evs) => handlerRef.current(evs),
      onSnapshot: (p, t, fl) => { setPub(p); setTime(t); setFinishLine(fl); },
      onDone: () => doneRef.current(race),
      getSpeed: () => speedRef.current,
    }, theme);
    // 경기마다 새 캔버스 사용: Phaser 전역 캔버스 풀 재사용 시 이전 경기 정리 과정이 새 경기 WebGL 컨텍스트를 깨뜨려
    // '다시 하기' 직후 탭이 충돌하는 문제가 있었음
    const canvas = document.createElement('canvas');
    const game = new Phaser.Game({
      type: Phaser.WEBGL,
      canvas,
      parent: hostRef.current!,
      width: VIEW_W,
      height: VIEW_H,
      backgroundColor: '#8fd3ff',
      scale: { mode: Phaser.Scale.NONE },
      audio: { noAudio: true },
      banner: false,
      scene: [scene],
    });
    return () => {
      // 경기 화면 종료 시 WebGL 컨텍스트를 즉시 해제해 다시 하기 반복 시 GPU 메모리 누적 방지
      const gl = (game.renderer as { gl?: WebGLRenderingContext } | null)?.gl;
      game.destroy(true);
      if (gl) setTimeout(() => gl.getExtension('WEBGL_lose_context')?.loseContext(), 200);
    };
  }, [race, theme]);

  const n = lineup.length;
  const rowH = Math.min(86, 880 / n);
  const leader = pub.find((p) => p.rank === 1);
  const finishedCount = pub.filter((p) => p.finished).length;
  const leadPos = pub.reduce((m, p) => (p.finished ? m : Math.max(m, p.pos)), 0);
  const remain = finishedCount === n ? 0 : Math.max(0, Math.ceil(finishLine - leadPos));

  return (
    <div className="race-screen">
      <header className="race-header">
        <div className="race-title">꾸한성 대환장 운동회</div>
        <div className="race-clock">⏱ {time.toFixed(2)}<small>s</small></div>
        <div className={`race-dist${race.finishMoved ? ' moved' : ''}`}>🏁 결승선 {finishLine}m</div>
        <div className="remain-badge" title="선두 기준 결승선까지 남은 거리">
          <UiImg name="distance" />
          <span className="remain-num">{remain}m</span>
        </div>
        <div className="race-ctrl">
          <span className="finished-count">완주 {finishedCount}/{n}</span>
          <div className="speed-panel">
            <UiImg name="speed" />
            {[1, 2].map((v) => (
              <button key={v} className={`sp-btn sp${v}${speed === v ? ' on' : ''}`} aria-label={`${v}배속`} aria-pressed={speed === v}
                onClick={() => { speedRef.current = v; setSpeed(v); }} />
            ))}
            {/* 이미지의 '설정' 버튼 자리 = 효과음 켜기/끄기 */}
            <button className={`sp-btn sp3${muted ? ' on' : ''}`} aria-label={muted ? '효과음 켜기' : '효과음 끄기'}
              onClick={() => { setMuted(!muted); setMutedState(!muted); }}>{muted && <span className="sp-mute">🔇</span>}</button>
          </div>
          <button className="btn small ghost" onClick={onExit}>나가기</button>
        </div>
      </header>

      {/* 진행 상황 미니맵 (보조 표시) */}
      <div className="minimap">
        <div className="mm-track">
          {[...Array(Math.floor(finishLine / 10) + 1)].map((_, i) => (
            <span key={i} className="mm-tick" style={{ left: `${((i * 10) / finishLine) * 100}%` }}>{i * 10}</span>
          ))}
          <span className="mm-finish">🏁</span>
          {pub.map((p) => (
            <span
              key={p.index}
              className={`mm-dot${p.finished ? ' done' : ''}`}
              style={{ left: `${Math.min(100, (p.pos / finishLine) * 100)}%`, background: CHAR_BY_ID[p.id].color, zIndex: 20 - p.rank }}
              title={p.name}
            >{p.name[0]}</span>
          ))}
        </div>
      </div>

      <div className="track-host" ref={hostRef} style={{ width: VIEW_W, height: VIEW_H }} />

      {count !== null && (
        <div className="countdown-wrap">
          <UiImg name="countdown" className="countdown-frame" />
          <div className="countdown" key={count}>{count > 0 ? count : 'GO!'}</div>
        </div>
      )}

      {banner && (
        <div className="finish-change">
          <UiImg name="finishChange" fallback={<div className="event-banner">🏁 결승선이 도망갑니다!</div>} />
          <span className="fc-value">{banner.from}m → {banner.to}m</span>
        </div>
      )}

      <div className="notices">
        {notices.map((nt) => (
          <div key={nt.id} className={`notice ${nt.kind}`} style={{ '--c': nt.color } as React.CSSProperties}>
            <UiImg name={nt.kind === 'skill' ? 'skill' : nt.kind === 'overtake' ? 'overtake' : 'firstPlace'} />
            <div className="notice-text"><b>{nt.who}</b>{nt.text}</div>
          </div>
        ))}
      </div>

      {cutin && (() => {
        const d = defs[cutin.actor];
        return (
          <div className="cutin" key={cutin.id} style={{ '--c': d.color, '--a': d.accent } as React.CSSProperties}>
            <div className="cutin-band">
              <img className="cutin-frame" src={assetUrl(EFFECT_IMAGES.cutin)} alt="" onError={(ev) => { ev.currentTarget.style.display = 'none'; }} />
              <Avatar def={d} size={104} pose="ultimate" />
              <UiImg name="ultimate" className="cutin-ult" />
              <div className="cutin-text">
                <div className="cutin-who">{d.name}</div>
                <div className="cutin-name">{cutin.name}</div>
                <div className="cutin-line">“{cutin.line}”</div>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast" style={{ borderColor: t.color }}>{t.text}</div>
        ))}
      </div>

      <aside className="rank-panel" style={{ borderImageSource: `url(${uiUrl('leaderboard')})` }}>
        <h2><span className="rp-title">실시간 순위</span> {leader && <span key={leaderFlash} className="lead-flash">👑 {leader.name}</span>}</h2>
        <div className="rank-rows" style={{ height: rowH * n }}>
          {pub.map((p) => {
            const d = CHAR_BY_ID[p.id];
            const gap = leader && !p.finished && leader.index !== p.index && !leader.finished ? leader.pos - p.pos : null;
            return (
              <div key={p.index} className={`rank-row${p.finished ? ' done' : ''}`}
                style={{ transform: `translateY(${(p.rank - 1) * rowH}px)`, height: rowH - 6, borderColor: d.color }}>
                <span className={`rk rk${p.rank}`}>{p.rank}</span>
                <Avatar def={d} size={Math.min(52, rowH - 18)} />
                <div className="rk-info">
                  <div className="rk-name">
                    {p.name}
                    <span className="rk-status">
                      {p.boosted && <UiImg name="lightning" className="st-ic" alt="가속" />}
                      {p.immune && <UiImg name="shield" className="st-ic" alt="면역" />}
                      {p.cheered && <UiImg name="heart" className="st-ic" alt="응원" />}
                      {p.confused && <UiImg name="question" className="st-ic" alt="혼란" />}
                      {(p.slowed || p.fallen) && <UiImg name="warning" className="st-ic" alt="감속" />}
                    </span>
                  </div>
                  <div className="rk-pos">
                    {p.finished ? `✅ ${p.finishTime!.toFixed(3)}초` : `${p.pos.toFixed(1)}m${gap !== null ? ` (-${gap.toFixed(1)}m)` : ''}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      <section className="commentary">
        {/* 최신 중계: commentary_panel 카드 안에 동적 문장 (최대 2줄, 넘치면 말줄임) */}
        <div className="cm-card">
          <UiImg name="commentary" fallback={<div className="cm-card-fallback" />} />
          <div className={`cm-card-text ${comments[0]?.tone ?? ''}`} key={comments[0]?.id ?? 0}>
            {comments[0]?.text ?? '곧 경기가 시작됩니다!'}
          </div>
        </div>
        <div className="cm-side">
          <div className="cm-title"><UiImg name="ticker" className="cm-ticker" fallback={<>🎙️ 실시간 중계</>} /></div>
          <ul>
            {comments.slice(1).map((c) => {
              const framed = c.tone === 'event' || c.tone === 'ult'; // 주요 이벤트는 announcer 프레임으로 강조
              return (
                <li key={c.id} className={`cm ${c.tone}${framed ? ' framed' : ''}`}
                  style={framed ? { borderImageSource: `url(${uiUrl('announcer')})` } : undefined}>
                  <span className="cm-t">{c.t.toFixed(1)}s</span> {c.text}
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </div>
  );
}
