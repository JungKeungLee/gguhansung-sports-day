import { useId, useMemo, useState } from 'react';
import { type MapId, mapInfo } from '../pinball/maps';
import { pinballPreview } from '../pinball/PinballScene';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const SEGS = 5;   // 세로로 긴 맵을 5구간으로 잘라 나란히 표시
const GAP = 40;

/** 맵 미리보기: 실제 경기 배치 함수를 그대로 실행해 SVG 로 축소 표시 (물리 없음). 클릭하면 크게 보기 */
export function PinballMapPreview({ mapId }: { mapId: MapId }) {
  const [big, setBig] = useState(false);
  const uid = useId().replace(/:/g, '');
  const pv = useMemo(() => pinballPreview(mapId, 1), [mapId]); // 랜덤 맵은 대표 배치(seed 1)
  const segH = Math.ceil(pv.H / SEGS);
  const t = pv.theme;

  const art = (
    <g>
      <rect x={0} y={0} width={pv.W} height={pv.H} fill={hex(t.bgTop)} />
      <rect x={40} y={40} width={pv.W - 80} height={pv.startBottom - 40} fill="#d4a017" opacity={0.18} />
      <text x={pv.W / 2} y={34} textAnchor="middle" fontSize={34} fontWeight={900} fill="#ffd166">START</text>
      <rect x={40} y={pv.gateY} width={pv.W - 80} height={pv.H - pv.gateY} fill="#c62828" opacity={0.18} />
      {pv.shapes.map((s, i) => {
        switch (s.k) {
          case 'rect': return <rect key={i} x={-s.w / 2} y={-s.h / 2} width={s.w} height={s.h} fill={hex(s.color)} stroke={hex(t.stroke)} strokeWidth={2} transform={`translate(${s.x} ${s.y}) rotate(${s.deg})`} />;
          case 'pin': return <circle key={i} cx={s.x} cy={s.y} r={s.r + 1} fill={hex(s.color)} />;
          case 'bumper': return <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#ff4d6d" stroke="#ffd166" strokeWidth={4} />;
          case 'rotor': return (
            <g key={i}>
              {s.y >= pv.finTop && <line x1={pv.W / 2 - pv.finGap / 2 - (pv.gateY - s.y)} y1={s.y} x2={s.x} y2={s.y} stroke={hex(t.stroke)} strokeWidth={8} />}
              <g transform={`translate(${s.x} ${s.y})`}>
                <circle r={s.len / 2} fill="#ffd166" opacity={0.12} />
                {Array.from({ length: s.arms }, (_, a) => <rect key={a} x={-s.len / 2} y={-s.thick / 2} width={s.len} height={s.thick} fill="#ffd166" transform={`rotate(${(180 * a) / s.arms})`} />)}
                <circle r={6} fill="#fff" />
              </g>
            </g>
          );
          case 'portal': return (
            <g key={i} stroke={hex(s.color)}>
              <line x1={s.ax} y1={s.ay} x2={s.bx} y2={s.by} strokeWidth={3} strokeDasharray="10 10" opacity={0.5} />
              <circle cx={s.ax} cy={s.ay} r={26} fill="#000" strokeWidth={8} />
              <circle cx={s.bx} cy={s.by} r={24} fill="none" strokeWidth={5} />
            </g>
          );
        }
      })}
      <rect x={pv.W / 2 - pv.finGap / 2} y={pv.finishY - 8} width={pv.finGap} height={16} fill="#fff" />
      <text x={pv.W / 2} y={pv.finishY + 100} textAnchor="middle" fontSize={40} fontWeight={900} fill="#ffd166">FINISH</text>
    </g>
  );

  const svg = (cls: string) => (
    <svg className={cls} viewBox={`0 0 ${SEGS * pv.W + (SEGS - 1) * GAP} ${segH}`} role="img" aria-label={`${mapInfo(mapId).name} 미리보기`}>
      <defs>
        <clipPath id={`${uid}c`}><rect x={0} y={0} width={pv.W} height={segH} /></clipPath>
        <g id={`${uid}a`}>{art}</g>
      </defs>
      {Array.from({ length: SEGS }, (_, i) => (
        <g key={i} transform={`translate(${i * (pv.W + GAP)} 0)`}>
          <g clipPath={`url(#${uid}c)`}><use href={`#${uid}a`} transform={`translate(0 ${-i * segH})`} /></g>
          {i < SEGS - 1 && <text x={pv.W + GAP / 2} y={segH / 2} textAnchor="middle" fontSize={44} fill="#ffd166">›</text>}
        </g>
      ))}
    </svg>
  );

  return (
    <>
      <button type="button" className="pb-mapview" data-map={mapId} onClick={() => setBig(true)} title="크게 보기">
        {svg('pb-mapview-svg')}
        <span className="pb-mapview-note">
          {mapId === 'chaos' ? '대표 배치 예시 · 실제 경기 배치는 매번 달라요' : '왼쪽 위 START → 오른쪽 아래 FINISH'} · 🔍 크게 보기
        </span>
      </button>
      {big && (
        <div className="pb-mapview-modal" onClick={() => setBig(false)} role="dialog" aria-label="맵 미리보기 크게 보기">
          <div className="pb-label">{mapInfo(mapId).icon} {mapInfo(mapId).name}{mapId === 'chaos' && ' (대표 배치 — 실제 배치는 매번 달라요)'}</div>
          {svg('pb-mapview-big')}
          <div className="pb-mapview-note">화면을 누르면 닫혀요</div>
        </div>
      )}
    </>
  );
}
