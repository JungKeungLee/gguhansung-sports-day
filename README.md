# 꾸한성 대환장 운동회 — 100m 자동 달리기

PC 브라우저용 자동 레이싱 관전 게임 (React + TypeScript + Phaser 3 + Vite). 서버·DB·로그인 없음, 정적 배포 가능.

```bash
npm install
npm run dev        # 개발 서버
npm run build      # dist/ 정적 빌드
npm test           # 규칙 단위 테스트
npm run balance    # 10,000경기 자동 시뮬레이션 (인자: 경기수 인원)
npm run e2e        # 브라우저 QA (build 후, Chrome 필요)
```

- `?seed=숫자` 를 URL에 붙이면 같은 경기를 재현합니다.
- 캐릭터 이미지(WebP 4종): `public/characters/{id}_run|skill|ultimate|victory.webp` — `src/game/images.ts` 에서 10명 모두 연결됨
  - 점검: `npm run check-images` (캐릭터 40 + 배경 3·장애물 5·이펙트 13: 존재·WebP·투명·크기)
- 경기장(낮/야간)·장애물·이펙트·시상식 경로도 `src/game/images.ts` 에서 관리. 경기장 이미지는 관중석·잔디만 잘라 반복하고 레인은 인원수에 맞춰 직접 그림
- 브라우저 통합 QA: `npm run build && npm run e2e` (2/5/10명, 낮·야간, 3개 해상도, 결승선 이동, 시상식, 복사, 다시 하기, FPS)
  - 빠진 포즈는 run 이미지로, 파일이 없거나 깨지면 색상 임시 캐릭터로 자동 대체
  - 사용처: run=경기·선택·순위, skill=스킬 발동 0.9초, ultimate=필살기 2초·컷인, victory=완주 1~3위·시상대
  - id: yappu, harunotsuki, manjo, moya, yuntami, yamuji, nanwony, kkutinho, kimokdok, damyu

## 구조
| 경로 | 역할 |
|---|---|
| `src/game/config.ts` | 밸런스 설정값 (속도, 쿨타임, 게이지, 장애물, 이벤트) |
| `src/game/characters.ts` | 캐릭터 10명·스킬 30개 데이터 |
| `src/game/sim/runner.ts` | 공통: 속도 계산·가감속·상태이상·면역·쿨타임·게이지·피격 |
| `src/game/sim/skills.ts` | 대상 선택·발동 조건·스킬 실행·자동 사용 AI |
| `src/game/sim/obstacles.ts` | 장애물 생성·충돌·함정 |
| `src/game/sim/events.ts` | 결승선 이동·관중 응원 이벤트 |
| `src/game/sim/race.ts` | 고정 간격 시뮬레이션·결승선 보간 판정·순위 |
| `src/game/result.ts` | 공동 순위·복사 텍스트 |
| `src/scenes/RaceScene.ts` | Phaser 렌더링 (보간·카메라·이펙트) |
| `src/ui/*` | 선택/경기 HUD/컷인/중계/결과 화면, 효과음 |
