import { useEffect, useMemo, useRef, useState } from 'react';
import Phaser from 'phaser';
import { type BallRecord, type BallSpec, type WinMode, WIN_MODE_LABEL, rankBalls } from '../pinball/entries';
import { PB_VIEW_H, PB_VIEW_W, PinballScene } from '../pinball/PinballScene';
import { type MapId, mapInfo } from '../pinball/maps';
import { sfx } from './sound';
import { useSoundSettings } from './SoundPanel';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** 핀볼 경기 화면: 출발 / 재시작 / 메인 복귀, 도착 기록 표시 */
export function PinballScreen({ balls, mode, mapId, keepOrder = false, onHome, onSettings, onDone }: {
  balls: BallSpec[]; mode: WinMode; mapId: MapId; keepOrder?: boolean; onHome: () => void; onSettings: () => void; onDone: (records: BallRecord[]) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PinballScene | null>(null);
  const [round, setRound] = useState(1);              // 재시작마다 증가 → 새 맵·새 출발 배치
  // ?pbseed=숫자 로 같은 경기 재현 (QA용, 100m의 ?seed 와 동일한 방식)
  const seed = useMemo(() => {
    const v = new URLSearchParams(location.search).get('pbseed');
    return v && /^\d+$/.test(v) ? Number(v) >>> 0 : (Math.random() * 2 ** 32) >>> 0;
  }, [round]);
  const [phase, setPhase] = useState<'ready' | 'running' | 'done'>('ready');
  const [records, setRecords] = useState<BallRecord[]>([]);
  const [tick, setTick] = useState({ t: 0, finished: 0, unstuck: 0, portals: 0 });
  const { muted } = useSoundSettings();
  const [speed, setSpeed] = useState(1);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    setPhase('ready'); setRecords([]); setTick({ t: 0, finished: 0, unstuck: 0, portals: 0 }); setSpeed(1); // 새 경기는 1배속
    let first = true;
    // 500개 대응: 도착 기록은 ref 에 모으고 화면 갱신은 0.3초마다 한 번, 완주음도 0.15초에 최대 1번
    const recs: BallRecord[] = [];
    let dirty = false, lastFlush = 0, lastSfx = 0;
    const scene = new PinballScene(balls, seed, {
      onFinish: (rec) => {
        recs.push(rec); dirty = true;
        const now = performance.now();
        if (first) { first = false; lastSfx = now; if (mode === 'first') sfx.winner(); else sfx.finish(); }
        else if (now - lastSfx > 150) { lastSfx = now; sfx.finish(); }
      },
      onTick: (t) => {
        setTick(t);
        const now = performance.now();
        if (dirty && now - lastFlush > 300) { dirty = false; lastFlush = now; setRecords([...recs]); }
      },
      onAllFinished: (all) => {
        setRecords(all); setPhase('done'); if (mode === 'last') sfx.winner();
        setTimeout(() => doneRef.current(all), 1600); // 잠시 보여준 뒤 결과 화면으로
      },
    }, mode, mapId, keepOrder);
    sceneRef.current = scene;
    const canvas = document.createElement('canvas'); // 경기마다 새 캔버스 (100m와 동일한 정리 방식)
    const game = new Phaser.Game({
      type: Phaser.WEBGL, canvas, parent: hostRef.current!, width: PB_VIEW_W, height: PB_VIEW_H,
      backgroundColor: '#140608', scale: { mode: Phaser.Scale.NONE }, audio: { noAudio: true }, banner: false,
      physics: { default: 'matter', matter: { gravity: { x: 0, y: 1 }, enableSleeping: true, /* 움직임이 멈춘 공은 물리 연산 생략 (충돌·이동 시 자동 활성화) */ runner: { isFixed: true, delta: 1000 / 60 } } },
      scene: [scene],
    } as Phaser.Types.Core.GameConfig);
    return () => {
      const gl = (game.renderer as { gl?: WebGLRenderingContext } | null)?.gl;
      game.destroy(true);
      sceneRef.current = null;
      if (gl) setTimeout(() => gl.getExtension('WEBGL_lose_context')?.loseContext(), 200);
    };
  }, [balls, seed, mode, mapId, keepOrder]);

  const changeSpeed = (v: number) => { setSpeed(v); sceneRef.current?.setSpeed(v); };
  const start = () => { sceneRef.current?.startRace(); setPhase('running'); sfx.go(); };
  const ranking = rankBalls(records, mode);
  const arrivalsAll = [...records].filter((r) => r.finishOrder !== null).sort((a, b) => a.finishOrder! - b.finishOrder!);
  const arrivals = arrivalsAll.slice(0, 100); // 경기 중 목록은 앞 100개만 (전체는 결과 화면)

  return (
    <div className="pb-screen">
      <header className="race-header">
        <div className="race-title">🎱 핀볼 레이스 · {mapInfo(mapId).icon} {mapInfo(mapId).name}</div>
        <div className="race-clock">⏱ {tick.t.toFixed(2)}<small>s</small></div>
        <div className="race-dist">{mode === 'first' ? '🥇' : '🐢'} {WIN_MODE_LABEL[mode]}</div>
        <div className="race-ctrl">
          <span className="finished-count">도착 {tick.finished}/{balls.length}</span>
          <div className="pb-speed" role="group" aria-label="배속">
            {[1, 2, 3].map((v) => (
              <button key={v} type="button" className={`pb-speed-btn${speed === v ? ' on' : ''}`} aria-pressed={speed === v}
                aria-label={`${v}배속`} onClick={() => changeSpeed(v)}>{v}x</button>
            ))}
          </div>
          <button className="btn small" onClick={onSettings}>⚙️ 설정{muted ? ' 🔇' : ''}</button>
          <button className="btn small ghost" onClick={onHome}>메인</button>
        </div>
      </header>

      <aside className="pb-left">
        <div className="pb-stat"><span>참가 공</span><b>{balls.length}개</b></div>
        <div className="pb-stat"><span>도착</span><b>{tick.finished}개</b></div>
        <div className="pb-stat"><span>끼임 복구</span><b>{tick.unstuck}회</b></div>
        {(mapId === 'portal' || mapId === 'chaos') && <div className="pb-stat"><span>포털 이동</span><b>{tick.portals}회</b></div>}
        <div className="pb-actions">
          {phase === 'ready' && <button className="btn primary big" onClick={start}>출발 ▶</button>}
          <button className="btn big" onClick={() => setRound((r) => r + 1)}>🔁 재시작</button>
          <button className="btn ghost big" onClick={onHome}>🏠 메인 화면</button>
        </div>
        {phase === 'done' && ranking.winner && (
          <div className="pb-winner" style={{ borderColor: hex(ranking.winner.color) }}>
            🏆 우승 <b>{ranking.winner.label}</b>
            <small>{ranking.winner.finishOrder}번째 도착 · {mode === 'first' ? '가장 먼저 도착' : '가장 늦게 도착'}</small>
          </div>
        )}
        {phase === 'running' && mode === 'first' && ranking.winner && (
          <div className="pb-winner" style={{ borderColor: hex(ranking.winner.color) }}>🥇 1등 확정 <b>{ranking.winner.label}</b><small>나머지 공 도착 중…</small></div>
        )}
        {phase === 'running' && mode === 'last' && (
          <div className="pb-note">🐢 마지막 공이 도착할 때까지 우승자는 정해지지 않아요</div>
        )}
      </aside>

      <div className="pb-host" ref={hostRef} style={{ width: PB_VIEW_W, height: PB_VIEW_H }} />

      <aside className="pb-right">
        <h2>도착 순서</h2>
        <ol className="pb-arrivals">
          {arrivals.map((r) => (
            <li key={r.id}>
              <span className="pa-no">{r.finishOrder}</span>
              <i style={{ background: hex(r.color) }} />
              <span className="pa-name">{r.label}</span>
            </li>
          ))}
          {arrivalsAll.length > 100 && <li className="pb-empty">… 외 {arrivalsAll.length - 100}개 도착 (전체 순위는 결과 화면)</li>}
          {!arrivals.length && <li className="pb-empty">{phase === 'ready' ? '출발 버튼을 눌러주세요' : '첫 도착을 기다리는 중…'}</li>}
        </ol>
      </aside>
    </div>
  );
}
