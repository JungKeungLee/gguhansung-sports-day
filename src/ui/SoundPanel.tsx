import { useEffect, useState } from 'react';
import { type SoundSettings, getSoundSettings, onSoundSettings, setSoundSettings } from './sound';

/** 사운드 설정 구독 훅 */
export function useSoundSettings(): SoundSettings {
  const [s, setS] = useState(getSoundSettings());
  useEffect(() => onSoundSettings(setS), []);
  return s;
}

/** 사운드 설정창 (메인·경기 화면 공용). 열고 닫아도 경기 진행에는 영향 없음 */
export function SoundPanel({ onClose }: { onClose: () => void }) {
  const s = useSoundSettings();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const slider = (label: string, key: 'bgm' | 'sfx', icon: string) => (
    <label className="sp-row">
      <span className="sp-label">{icon} {label}</span>
      <input type="range" min={0} max={100} step={1} value={Math.round(s[key] * 100)} aria-label={label}
        onChange={(e) => setSoundSettings({ [key]: Number(e.target.value) / 100 })} />
      <span className="sp-val">{Math.round(s[key] * 100)}%</span>
    </label>
  );

  return (
    <div className="sound-overlay" onClick={onClose}>
      <div className="sound-panel" role="dialog" aria-label="사운드 설정" onClick={(e) => e.stopPropagation()}>
        <h2>⚙️ 사운드 설정</h2>
        {slider('배경음악', 'bgm', '🎵')}
        {slider('효과음', 'sfx', '🔔')}
        <label className="sp-row">
          <span className="sp-label">🔇 전체 음소거</span>
          <button type="button" role="switch" aria-checked={s.muted} className={`sp-toggle${s.muted ? ' on' : ''}`}
            onClick={() => setSoundSettings({ muted: !s.muted })}>{s.muted ? 'ON' : 'OFF'}</button>
        </label>
        <button type="button" className="btn primary sp-close" onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}
