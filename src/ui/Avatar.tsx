import { useState } from 'react';
import type { CharDef } from '../game/types';
import { type Pose, imageCandidates, isFlipped } from '../game/images';

/** 캐릭터 이미지 (포즈 → run → 색상 플레이스홀더 순으로 대체) */
export function Avatar({ def, size, pose = 'run' }: { def: CharDef; size: number; pose?: Pose }) {
  const urls = imageCandidates(def.id, pose);
  const [failed, setFailed] = useState(0);
  const src = urls[failed];
  const usedPose: Pose = failed === 0 ? pose : 'run'; // 대체 이미지는 run
  if (src) {
    return (
      <img
        className="avatar"
        src={src}
        alt={def.name}
        width={size}
        height={size}
        onError={() => setFailed((n) => n + 1)}
        style={{ borderColor: def.color, transform: isFlipped(def.id, usedPose) ? 'scaleX(-1)' : undefined }}
      />
    );
  }
  return (
    <div
      className="avatar placeholder"
      style={{ width: size, height: size, background: def.color, fontSize: size * 0.42, borderColor: def.accent }}
      title={`${def.name} (임시 이미지)`}
    >
      {def.name[0]}
    </div>
  );
}
