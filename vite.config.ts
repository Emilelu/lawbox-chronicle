import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    // three/drei 体积较大，骨架期放宽告警阈值，后续模块接入再收敛
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    open: false,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: false,
    // 本仓 jsdom 不暴露 localStorage（zustand persist 依赖它）——全局垫片
    setupFiles: ['src/test/setupGlobals.ts'],
    // 引擎层纯函数测试不依赖 DOM，但统一走 jsdom 以覆盖未来 UI 组件测试
  },
});
