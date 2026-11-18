import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
  // Windows: 폴더를 소문자 드라이브(c:\...)로 열면 vitest CLI는 c:/ 경로, 테스트 파일의 'vitest' import는 C:/ 경로로 로드되어
  // 러너가 2개 생기고 describe()가 초기화 안 됨('config' 읽기 오류). 테스트의 'vitest' import를 CLI와 같은 경로로 고정 (테스트 전용 설정)
  test: { include: ['tests/**/*.test.ts'], alias: [{ find: /^vitest$/, replacement: `${process.cwd()}/node_modules/vitest/dist/index.js` }] },
} as any);
