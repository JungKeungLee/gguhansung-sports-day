import { CHARACTERS } from '../game/characters';
import { GATE_IMAGES, assetUrl } from '../game/images';
import { Avatar } from './Avatar';

/** 운동회 메인 화면: 종목 선택 + 사운드 설정 */
export function HomeScreen({ onRun100, onPinball, onSettings }: { onRun100: () => void; onPinball: () => void; onSettings: () => void }) {
  return (
    <div className="home-screen">
      <button type="button" className="btn small home-sound" onClick={onSettings}>⚙️ 사운드 설정</button>
      <header className="home-header">
        <div className="home-badge">🏅 꾸한성 체육대회 🏅</div>
        <h1 className="title-main">꾸한성 대환장 운동회</h1>
        <p className="home-intro">꾸한성 멤버 10명이 펼치는 예측불가 운동회! 종목을 고르고 응원만 하세요 📣</p>
      </header>

      <div className="home-parade" aria-hidden="true">
        {CHARACTERS.map((c, i) => (
          <div key={c.id} className="parade-runner" style={{ animationDelay: `${(i % 5) * 0.12}s` }}>
            <Avatar def={c} size={104} />
          </div>
        ))}
      </div>

      <div className="home-cards">
        <button type="button" className="event-card run" onClick={onRun100}>
          <img className="ec-art" src={assetUrl(GATE_IMAGES.finish)} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          <div className="ec-title">🏃 100m 달리기</div>
          <div className="ec-desc">스킬·필살기·장애물, 그리고 도망가는 결승선!<br />자동으로 달리는 대환장 레이스</div>
          <div className="ec-go">참가 선수 고르기 ▶</div>
        </button>
        <button type="button" className="event-card pinball" onClick={onPinball}>
          <div className="ec-ribbon">NEW</div>
          <div className="ec-ball">🎱</div>
          <div className="ec-title">🎱 핀볼 레이스</div>
          <div className="ec-desc">닉네임 공들이 핀을 튕기며 내려오는<br />운에 맡기는 물리 레이스!</div>
          <div className="ec-go">참가자 입력 ▶</div>
        </button>
      </div>
    </div>
  );
}
