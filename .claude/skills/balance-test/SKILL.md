---
name: balance-test
description: 꾸한성 대환장 운동회 스킬/캐릭터 수치를 바꾼 뒤 밸런스 검증 (단위 테스트 + 자동 시뮬레이션)
---
1. 수치 변경은 `src/game/config.ts`(공통) / `src/game/characters.ts`(캐릭터·스킬)만 수정. 새 효과가 필요하면 `src/game/types.ts`의 Action에 추가 후 `src/game/sim/skills.ts`의 `exec`/`actionValid`에 구현.
2. `npm test` — 규칙 테스트 전부 통과해야 함.
3. 빠른 확인: `npm run balance -- 2000` (약 30초). 확정 전: `npm run balance -- 10000` (약 2~3분). 인원 변경: `npm run balance -- 3000 4`.
4. 기준: 10인 경기 캐릭터별 우승률 대략 5~15%, 강제 종료/순위·시간 오류 0건, 꼴찌 완주 평균 30~60초.
5. 화면 확인이 필요하면 `npm run build && npm run e2e` (Chrome, 스크린샷은 e2e-shots/).
