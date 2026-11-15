import { useEffect, useMemo, useState } from 'react';
import { CHAR_BY_ID } from '../game/characters';
import { buildResults, formatCopyText, formatTime } from '../game/result';
import type { Race } from '../game/sim/race';
import { Avatar } from './Avatar';
import { sfx } from './sound';
import { EFFECT_IMAGES, VICTORY_STAGE, assetUrl } from '../game/images';
import { UiImg } from './UiImg';

/** victory_stage.webp(16:9)를 가로 1920px, 위로 260px 올려 표시했을 때 단상 위치(발 위치 y). 순서: 1등 중앙, 2등 왼쪽, 3등 오른쪽 */
const SPOTS = [
  { x: 962, feet: 400, size: 230 },
  { x: 534, feet: 462, size: 190 },
  { x: 1386, feet: 470, size: 190 },
];

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 클립보드 API 실패 시 대체 방식
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function ResultScreen({ race, onReplay, onMenu, onHome }: { race: Race; onReplay: () => void; onMenu: () => void; onHome: () => void }) {
  const rows = useMemo(() => buildResults(race), [race]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { sfx.winner(); }, []); // 시상식 BGM(victory)과 함께 1회

  // 시상대 배치: 완주 순서(동기록이면 기존 순위 판정과 같은 정렬) 1~3번째를 중앙·왼쪽·오른쪽 단상에
  const top3 = rows.slice(0, 3);
  const winners = rows.filter((r) => r.rank === 1);

  const onCopy = async () => {
    const ok = await copyText(formatCopyText(rows, race.finishLine));
    setMsg(ok
      ? { ok: true, text: '✅ 순위를 복사했어요! 카카오톡·디스코드에 붙여넣기 하세요.' }
      : { ok: false, text: '❌ 복사에 실패했어요. 브라우저 클립보드 권한을 확인해주세요.' });
    setTimeout(() => setMsg(null), 3000);
  };

  return (
    <div className="result-screen stage-mode">
      <div className="ceremony" style={{ backgroundImage: `url(${assetUrl(VICTORY_STAGE)})` }}>
        {/* 결과 요약 카드: race_result_panel(빈 패널, 상단 '경기 결과' 장식) 위에 동적 텍스트. 하단 잔여 문구 줄은 덮어씀 */}
        <div className="result-card">
          <UiImg name="result" fallback={<div className="result-card-fallback" />} />
          <div className="rc-body">
            <div className="rc-label">🏆 우승</div>
            <div className="rc-winner">{winners.map((w) => w.name).join(', ')}</div>
            <div className="rc-line">📏 결승선 <b>{race.finishLine}m</b>{race.finishMoved && <span className={`moved-tag${race.finishLine < race.cfg.baseFinish ? ' shorten' : ''}`}>{race.finishLine < race.cfg.baseFinish ? '단축!' : '연장!'}</span>}</div>
            <div className="rc-line">👥 참가 <b>{rows.length}명</b></div>
          </div>
          <div className="rc-foot">꾸한성 대환장 운동회</div>
        </div>
        {top3[0] && (
          <img className="victory-glow" src={assetUrl(EFFECT_IMAGES.victory)} alt=""
            style={{ left: SPOTS[0].x - 190, top: SPOTS[0].feet - SPOTS[0].size - 40, width: 380, height: 380 }}
            onError={(ev) => { ev.currentTarget.style.display = 'none'; }} />
        )}
        {top3.map((r, i) => {
          const sp = SPOTS[i];
          const tie = rows.filter((x) => x.rank === r.rank).length > 1;
          return (
            <div key={r.index} className={`podium-spot s${i}`}
              style={{ left: sp.x - sp.size / 2, top: sp.feet - sp.size - 62, width: sp.size }}>
              <div className="spot-label">
                {['🥇', '🥈', '🥉'][r.rank - 1] ?? ''} {r.name}{tie && ' (공동)'}
                <small>{r.rank}등 · {formatTime(r.timeMs)}초</small>
              </div>
              <Avatar def={CHAR_BY_ID[r.id]} size={sp.size} pose="victory" />
            </div>
          );
        })}
      </div>

      <div className="result-bottom">
        <table className="result-table">
          <thead>
            <tr><th>순위</th><th>캐릭터</th><th>완주 시간</th><th>스킬 사용</th><th>필살기</th><th>장애물 피격</th><th>회피</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const tie = rows.filter((x) => x.rank === r.rank).length > 1;
              return (
                <tr key={r.index} className={`rank${r.rank}`}>
                  <td className="t-rank">{r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : ''} {r.rank}등{tie && <small> (공동)</small>}</td>
                  <td className="t-name"><span className="dot" style={{ background: CHAR_BY_ID[r.id].color }} />{r.name}</td>
                  <td className="t-time">{formatTime(r.timeMs)}초</td>
                  <td>{r.stats.skillUses}회</td>
                  <td>{r.stats.ultUsed ? `💥 ${r.stats.ultTime!.toFixed(1)}s` : '—'}</td>
                  <td>{r.stats.obstacleHits}회</td>
                  <td>{r.stats.dodges}회</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="result-side">
          <button className="btn primary big" onClick={onCopy}>📋 순위 복사</button>
          <button className="btn big" onClick={onReplay}>🔁 다시 하기</button>
          <button className="btn ghost big" onClick={onMenu}>👥 멤버 다시 선택</button>
          <button className="btn ghost big" onClick={onHome}>🏠 메인 화면</button>
        </div>
      </div>
      {msg && <div className={`copy-msg ${msg.ok ? 'ok' : 'fail'}`}>{msg.text}</div>}
      <div className="seed">경기 시드 #{race.seed}</div>
    </div>
  );
}
