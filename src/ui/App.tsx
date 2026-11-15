import { useEffect, useState } from 'react';
import type { CharId } from '../game/types';
import { randomSeed } from '../game/rng';
import type { Race } from '../game/sim/race';
import { SelectScreen } from './SelectScreen';
import { RaceScreen } from './RaceScreen';
import { ResultScreen } from './ResultScreen';
import { type BgmName, initAudio, installAudioUnlock, playBgm } from './sound';
import { HomeScreen } from './HomeScreen';
import { SoundPanel } from './SoundPanel';
import { type MemberPick, PinballSetup } from './PinballSetup';
import { PinballScreen } from './PinballScreen';
import { PinballResult } from './PinballResult';
import { type BallRecord, type BallSpec, type WinMode } from '../pinball/entries';
import type { MapId } from '../pinball/maps';
import type { StadiumTheme } from '../game/images';

type Screen =
  | { kind: 'home' }
  | { kind: 'pbSetup' }
  | { kind: 'pinball'; balls: BallSpec[]; mode: WinMode; mapId: MapId; key: number; keepOrder?: boolean }
  | { kind: 'pbResult'; balls: BallSpec[]; mode: WinMode; mapId: MapId; records: BallRecord[] }
  | { kind: 'select' }
  | { kind: 'race'; lineup: CharId[]; seed: number; key: number }
  | { kind: 'result'; race: Race; lineup: CharId[] };

/** 1920×1080 기준 스테이지를 창 크기에 맞춰 비율 유지 스케일 */
function useStageScale(): number {
  const calc = () => Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  const [s, setS] = useState(calc);
  useEffect(() => {
    const on = () => setS(calc());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return s;
}

function seedFromUrl(): number | null {
  const v = new URLSearchParams(location.search).get('seed');
  return v && /^\d+$/.test(v) ? Number(v) >>> 0 : null;
}

export function App() {
  const scale = useStageScale();
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const [soundOpen, setSoundOpen] = useState(false);
  const [pbText, setPbText] = useState(''); // 자유 입력 기본값은 빈 칸 (예시는 placeholder로 안내)
  const [pbMode, setPbMode] = useState<WinMode>('first');
  const [pbPicks, setPbPicks] = useState<MemberPick>({});
  const [pbMap, setPbMap] = useState<MapId>('basic'); // 기본: 기본 핀볼
  useEffect(() => { installAudioUnlock(); }, []);
  // 화면별 BGM: 메인·선택=main(유지), 경기=race, 시상식=victory
  useEffect(() => {
    const map: Record<Screen['kind'], BgmName> = { home: 'main', select: 'main', race: 'race', result: 'victory', pbSetup: 'main', pinball: 'race', pbResult: 'victory' };
    playBgm(map[screen.kind]);
  }, [screen.kind]);
  const [lastLineup, setLastLineup] = useState<CharId[]>([]);
  const [theme, setTheme] = useState<StadiumTheme>('day'); // 기본: 낮 경기장

  const start = (lineup: CharId[]) => {
    initAudio();
    setLastLineup(lineup);
    setScreen({ kind: 'race', lineup, seed: seedFromUrl() ?? randomSeed(), key: Date.now() });
  };

  return (
    <div className="viewport">
      <div className="stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        {screen.kind === 'home' && (
          <HomeScreen onRun100={() => setScreen({ kind: 'select' })} onPinball={() => setScreen({ kind: 'pbSetup' })} onSettings={() => setSoundOpen(true)} />
        )}
        {screen.kind === 'pbSetup' && (
          <PinballSetup text={pbText} onText={setPbText} picks={pbPicks} onPicks={setPbPicks} mapId={pbMap} onMap={setPbMap} mode={pbMode} onMode={setPbMode} onHome={() => setScreen({ kind: 'home' })}
            onStart={(balls, keepOrder) => setScreen({ kind: 'pinball', balls, mode: pbMode, mapId: pbMap, key: Date.now(), keepOrder })} />
        )}
        {screen.kind === 'pinball' && (
          <PinballScreen key={screen.key} balls={screen.balls} mode={screen.mode} mapId={screen.mapId} keepOrder={screen.keepOrder} onHome={() => setScreen({ kind: 'home' })} onSettings={() => setSoundOpen(true)}
            onDone={(records) => setScreen({ kind: 'pbResult', balls: screen.balls, mode: screen.mode, mapId: screen.mapId, records })} />
        )}
        {screen.kind === 'pbResult' && (
          <PinballResult records={screen.records} mode={screen.mode} mapId={screen.mapId}
            onReplay={() => setScreen({ kind: 'pinball', balls: screen.balls, mode: screen.mode, mapId: screen.mapId, key: Date.now() })}
            onSetup={() => setScreen({ kind: 'pbSetup' })} onHome={() => setScreen({ kind: 'home' })} />
        )}
        {screen.kind === 'select' && (
          <SelectScreen initial={lastLineup} onStart={start} theme={theme} onTheme={setTheme} onHome={() => setScreen({ kind: 'home' })} />
        )}
        {screen.kind === 'race' && (
          <RaceScreen
            key={screen.key}
            lineup={screen.lineup}
            seed={screen.seed}
            theme={theme}
            onSettings={() => setSoundOpen(true)}
            onExit={() => setScreen({ kind: 'select' })}
            onDone={(race) => setScreen({ kind: 'result', race, lineup: screen.lineup })}
          />
        )}
        {screen.kind === 'result' && (
          <ResultScreen
            race={screen.race}
            onReplay={() => start(screen.lineup)}
            onMenu={() => setScreen({ kind: 'select' })}
            onHome={() => setScreen({ kind: 'home' })}
          />
        )}
        {soundOpen && <SoundPanel onClose={() => setSoundOpen(false)} />}
      </div>
    </div>
  );
}
