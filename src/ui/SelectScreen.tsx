import { useState } from 'react';
import { CHARACTERS } from '../game/characters';
import type { CharId } from '../game/types';
import { Avatar } from './Avatar';
import type { StadiumTheme } from '../game/images';
import { MAX_PLAYERS, MIN_PLAYERS, canStart, toggleSelect } from './selection';

export function SelectScreen({ initial, onStart, theme, onTheme }: {
  initial: CharId[]; onStart: (ids: CharId[]) => void; theme: StadiumTheme; onTheme: (t: StadiumTheme) => void;
}) {
  const [selected, setSelected] = useState<CharId[]>(initial);
  const ok = canStart(selected);

  return (
    <div className="select-screen">
      <header className="select-header">
        <h1>
          <span className="title-main">꾸한성 대환장 운동회</span>
          <span className="title-sub">🏁 100m 자동 달리기</span>
        </h1>
        <p className="howto">
          참가할 멤버를 고르고 시작만 누르세요! 캐릭터들이 <b>자동으로</b> 달리며 고유 스킬·필살기·장애물·
          <b>도망가는 결승선</b>으로 엎치락뒤치락 경쟁합니다. 필살기는 언제 터질지 아무도 모릅니다.
        </p>
      </header>

      <div className="char-grid">
        {CHARACTERS.map((c) => {
          const idx = selected.indexOf(c.id);
          const on = idx >= 0;
          return (
            <button
              key={c.id}
              className={`char-card${on ? ' on' : ''}`}
              style={{ '--c': c.color, '--a': c.accent } as React.CSSProperties}
              onClick={() => setSelected((s) => toggleSelect(s, c.id))}
              aria-pressed={on}
            >
              {on && <span className="pick-badge">{idx + 1}</span>}
              <Avatar def={c} size={112} />
              <div className="char-name">{c.name}</div>
              <div className="char-type">{c.type}</div>
              <ul className="skill-list">
                {c.skills.map((s) => (
                  <li key={s.id} title={s.desc}>✨ {s.name}</li>
                ))}
                <li className="ult" title={c.ult.desc}>💥 {c.ult.name}</li>
              </ul>
            </button>
          );
        })}
      </div>

      <footer className="select-footer">
        <div className="count">
          선택 <b>{selected.length}</b> / {MAX_PLAYERS}명
          {!ok && <span className="warn">최소 {MIN_PLAYERS}명을 선택하세요</span>}
        </div>
        <div className="theme-pick" role="radiogroup" aria-label="경기장">
          <span>경기장</span>
          {(['day', 'night'] as const).map((t) => (
            <button key={t} role="radio" aria-checked={theme === t} className={`theme-btn${theme === t ? ' on' : ''}`} onClick={() => onTheme(t)}>
              {t === 'day' ? '☀️ 낮' : '🌙 야간'}
            </button>
          ))}
        </div>
        <div className="btns">
          <button className="btn ghost" onClick={() => setSelected(CHARACTERS.map((c) => c.id))}>전체 선택</button>
          <button className="btn ghost" onClick={() => setSelected([])}>전체 해제</button>
          <button className="btn primary big" disabled={!ok} onClick={() => onStart(selected)}>
            경기 시작 ▶
          </button>
        </div>
      </footer>
    </div>
  );
}
