import { useMemo, useState } from 'react';
import { type BallRecord, type WinMode, WIN_MODE_LABEL, rankBalls } from '../pinball/entries';
import { ballNo, copyToClipboard, fmtOrder, formatPinballCopy } from '../pinball/result';
import { type MapId, mapInfo } from '../pinball/maps';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const MEDAL = ['🥇', '🥈', '🥉'];

/** 핀볼 경기 결과: 우승 공, 1~3등 시상대, 전체 순위(스크롤), 결과 복사, 다시 하기·참가자 재설정·메인 */
export function PinballResult({ records, mode, mapId, onReplay, onSetup, onHome }: {
  records: BallRecord[]; mode: WinMode; mapId: MapId; onReplay: () => void; onSetup: () => void; onHome: () => void;
}) {
  const ranking = useMemo(() => rankBalls(records, mode), [records, mode]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const podium = ranking.rows.slice(0, Math.min(3, ranking.rows.length)); // 2개면 3등 없음
  const order = [1, 0, 2].filter((i) => i < podium.length);               // 2등 왼쪽, 1등 가운데, 3등 오른쪽

  const onCopy = async () => {
    const ok = await copyToClipboard(formatPinballCopy(ranking, mode, records.length));
    setMsg(ok ? { ok: true, text: '✅ 전체 순위를 복사했어요!' } : { ok: false, text: '❌ 복사에 실패했어요. 클립보드 권한을 확인해주세요.' });
    setTimeout(() => setMsg(null), 2500);
  };

  return (
    <div className="pbr-screen">
      <header className="pbr-head">
        <div className="home-badge">🎱 핀볼 레이스 결과</div>
        <h1>🏆 {ranking.winner ? ballNo(ranking.winner) : '—'} 우승!</h1>
        <div className="pbr-sub">
          {mapInfo(mapId).icon} 맵 <b>{mapInfo(mapId).name}</b> · {mode === 'first' ? '🥇' : '🐢'} 우승 방식 <b>{WIN_MODE_LABEL[mode]}</b> · 참가 공 <b>{records.length}개</b>
        </div>
      </header>

      <div className="pbr-body">
        <section className="pbr-podium">
          {order.map((i) => {
            const r = podium[i];
            return (
              <div key={r.id} className={`pbr-spot p${i + 1}`}>
                <div className="pbr-ball" style={{ background: hex(r.color) }}>{r.name[0]}</div>
                <div className="pbr-name">{ballNo(r)}</div>
                <div className="pbr-time">{fmtOrder(r.finishOrder!)}</div>
                <div className="pbr-block">{MEDAL[r.rank - 1] ?? ''} {r.rank}등</div>
              </div>
            );
          })}
        </section>

        <section className="pbr-table-wrap">
          <table className="result-table pbr-table">
            <thead><tr><th>순위</th><th>닉네임</th><th>공 번호</th><th>도착 순서</th></tr></thead>
            <tbody>
              {ranking.rows.map((r) => (
                <tr key={r.id} className={`rank${r.rank}`}>
                  <td className="t-rank">{MEDAL[r.rank - 1] ?? ''} {r.rank}등</td>
                  <td className="t-name"><span className="dot" style={{ background: hex(r.color) }} />{r.name}</td>
                  <td>{r.ordinal}번</td>
                  <td>{fmtOrder(r.finishOrder!)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <footer className="pbr-btns">
        <button className="btn primary big" onClick={onCopy}>📋 결과 복사</button>
        <button className="btn big" onClick={onReplay}>🔁 다시 하기</button>
        <button className="btn ghost big" onClick={onSetup}>✏️ 참가자 재설정</button>
        <button className="btn ghost big" onClick={onHome}>🏠 메인 화면</button>
      </footer>
      {msg && <div className={`copy-msg ${msg.ok ? 'ok' : 'fail'}`}>{msg.text}</div>}
    </div>
  );
}
