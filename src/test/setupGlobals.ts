/**
 * vitest 全局 setup（vite.config.ts → test.setupFiles 挂载）。
 * ---------------------------------------------------------------------------
 * 本仓库的 vitest jsdom 环境不暴露 localStorage（jsdom 25 + vitest 2 实测
 * `typeof window.localStorage === 'undefined'`），而主 store（zustand persist）、
 * archive 统计/图鉴分片都依赖它 —— 浏览器无此问题，测试环境这里统一垫上
 * 内存实现（与 src/input/__tests__/localStorageShim.ts 同一逻辑，全局化后
 * 各测试文件不必再逐个先行 import）。
 */

class MemoryStorage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
}

const holder = globalThis as unknown as { localStorage?: Storage };

if (typeof holder.localStorage === 'undefined') {
  holder.localStorage = new MemoryStorage() as unknown as Storage;
}

export {};
