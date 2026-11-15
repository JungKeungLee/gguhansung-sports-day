import { useMemo, useState } from 'react';
import { CHARACTERS } from '../game/characters';
import type { CharId } from '../game/types';
import { type BallSpec, type EntryLine, MAX_BALLS, type WinMode, WIN_MODE_LABEL, ballLabel, buildEntries } from '../pinball/entries';
import { Avatar } from './Avatar';
import { type MapId, PINBALL_MAPS } from '../pinball/maps';
import { PinballMapPreview } from './PinballMapPreview';

/** 꾸한성 멤버 선택 상태: 체크 여부 + 공 개수 입력값(문자열 그대로 보관해 잘못된 값도 안내) */
export type MemberPick = Partial<Record<CharId, { on: boolean; count: string }>>;

/** 체크된 멤버 → `이름*개수` 줄 + 개수 오류 */
export function memberLines(picks: MemberPick): { lines: EntryLine[]; errors: string[] } {
  const lines: EntryLine[] = [];
  const errors: string[] = [];
  for (const c of CHARACTERS) {
    const p = picks[c.id];
    if (!p?.on) continue;
    if (!/^\d+$/.test(p.count.trim()) || Number(p.count) < 1) errors.push(`${c.name}: 공 개수는 1 이상의 숫자로 입력해주세요`);
    else lines.push({ name: c.name, count: Number(p.count) });
  }
  return { lines, errors };
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** 핀볼 참가자 설정: 닉네임(닉네임*개수) 입력 + 우승 방식 선택 */
export function PinballSetup({ text, onText, picks, onPicks, mapId, onMap, mode, onMode, onStart, onHome }: {
  text: string; onText: (t: string) => void; picks: MemberPick; onPicks: (p: MemberPick) => void;
  mapId: MapId; onMap: (m: MapId) => void;
  mode: WinMode; onMode: (m: WinMode) => void; onStart: (balls: BallSpec[], keepOrder: boolean) => void; onHome: () => void;
}) {
  const parsed = useMemo(() => {
    const m = memberLines(picks);
    return buildEntries(m.lines, text, m.errors); // 멤버 + 자유 입력을 하나의 목록으로
  }, [picks, text]);
  const setPick = (id: CharId, patch: Partial<{ on: boolean; count: string }>) =>
    onPicks({ ...picks, [id]: { on: false, count: '1', ...picks[id], ...patch } });
  const ok = parsed.errors.length === 0 && parsed.balls.length > 0;
  // 공 섞기: 공 목록(ID·이름)이 바뀌면 서명이 달라져 자동으로 원래 순서로 돌아감
  const sig = parsed.balls.map((b) => `${b.id}:${b.name}`).join('|');
  const [shuf, setShuf] = useState<{ sig: string; order: number[] } | null>(null);
  const shuffled = shuf && shuf.sig === sig ? shuf.order.map((i) => parsed.balls[i]) : null;
  const shown = shuffled ?? parsed.balls;
  const shuffle = () => {
    const o = parsed.balls.map((_, i) => i);
    for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } // Fisher-Yates
    setShuf({ sig, order: o });
  };

  return (
    <div className="pb-setup">
      <header className="pb-head">
        <div className="home-badge">🎱 핀볼 레이스</div>
        <h1>참가자 설정</h1>
        <p>꾸한성 멤버를 체크하거나, 자유 닉네임을 <b>이름*개수</b>로 입력하세요 (쉼표·줄바꿈으로 구분). 두 목록은 합쳐서 경기에 참가해요.</p>
      </header>

      <div className="pb-body">
        <section className="pb-members">
          <div className="pb-label">꾸한성 멤버</div>
          <div className="pb-member-grid">
            {CHARACTERS.map((c) => {
              const p = picks[c.id];
              const on = !!p?.on;
              return (
                <div key={c.id} className={`pb-member${on ? ' on' : ''}`}>
                  <label className="pbm-check">
                    <input type="checkbox" checked={on} onChange={(e) => setPick(c.id, { on: e.target.checked })} aria-label={`${c.name} 참가`} />
                    <Avatar def={c} size={44} />
                    <span>{c.name}</span>
                  </label>
                  <input className="pbm-count" type="number" min={1} max={MAX_BALLS} value={p?.count ?? '1'} disabled={!on}
                    aria-label={`${c.name} 공 개수`} onChange={(e) => setPick(c.id, { count: e.target.value })} />
                  <span className="pbm-unit">개</span>
                </div>
              );
            })}
          </div>
          <div className="pb-member-btns">
            <button type="button" className="btn small ghost" onClick={() => onPicks(Object.fromEntries(CHARACTERS.map((c) => [c.id, { on: true, count: picks[c.id]?.count ?? '1' }])))}>전체 체크</button>
            <button type="button" className="btn small ghost" onClick={() => onPicks({})}>전체 해제</button>
          </div>
        </section>

        <section className="pb-input">
          <label htmlFor="pb-names" className="pb-label">자유 닉네임 입력 (쉼표·줄바꿈 구분, 이름*개수)</label>
          <textarea id="pb-names" value={text} onChange={(e) => onText(e.target.value)} spellCheck={false}
            placeholder={'예시)\n돈까스*3, 피자*3, 햄버거*3\n난워니*3\n김옥독*2, 야뿌, 다뮤*2'} />
          <div className={`pb-total${parsed.total > MAX_BALLS ? ' over' : ''}`}>
            참가 공 <b>{parsed.total}</b> / 최대 {MAX_BALLS}개
          </div>
          {parsed.errors.length > 0 && (
            <ul className="pb-errors">{parsed.errors.map((e) => <li key={e}>⚠️ {e}</li>)}</ul>
          )}
        </section>

        <section className="pb-side">
          <div className="pb-label">맵 선택</div>
          <div className="pb-maps" role="radiogroup" aria-label="맵 선택">
            {PINBALL_MAPS.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={mapId === m.id} className={`pb-map${mapId === m.id ? ' on' : ''}`} onClick={() => onMap(m.id)}>
                <span className="pmap-icon">{m.icon}</span>
                <span className="pmap-name">{m.name}</span>
                <span className="pmap-desc">{m.desc}</span>
              </button>
            ))}
          </div>
          <PinballMapPreview mapId={mapId} />
          <div className="pb-label">우승 방식 (경기 중 변경 불가)</div>
          <div className="pb-modes" role="radiogroup" aria-label="우승 방식">
            {(['first', 'last'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} className={`pb-mode${mode === m ? ' on' : ''}`} onClick={() => onMode(m)}>
                <span className="pm-icon">{m === 'first' ? '🥇' : '🐢'}</span>
                <span className="pm-title">{m === 'first' ? 'A. ' : 'B. '}{WIN_MODE_LABEL[m]}</span>
                <span className="pm-desc">{m === 'first' ? '가장 먼저 결승선에 도착한 공이 1등' : '모든 공이 완주한 뒤 가장 늦게 도착한 공이 1등'}</span>
              </button>
            ))}
          </div>
          <div className="pb-label pb-prev-head">
            <span>참가 공 미리보기{shuffled && <em className="pb-shuffled"> · 섞인 순서로 출발</em>}</span>
            <button type="button" className="btn small ghost" disabled={parsed.balls.length < 2} onClick={shuffle}>🎲 공 섞기</button>
          </div>
          <div className="pb-preview">
            {shown.map((b) => (
              <span key={b.id} className="pb-chip"><i style={{ background: hex(b.color) }} />{ballLabel(b)}</span>
            ))}
            {!parsed.balls.length && <span className="pb-empty">닉네임을 입력하면 공이 표시돼요</span>}
          </div>
        </section>
      </div>

      <footer className="select-footer pb-foot">
        <button className="btn ghost" onClick={onHome}>← 메인</button>
        <button className="btn primary big" disabled={!ok} onClick={() => onStart(shown, !!shuffled)}>핀볼 경기장으로 ▶</button>
      </footer>
    </div>
  );
}
