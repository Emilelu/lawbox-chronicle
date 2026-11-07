/**
 * 测试环境 localStorage 垫片。
 * ---------------------------------------------------------------------------
 * 本仓库的 vitest jsdom 环境不暴露 localStorage（jsdom 25 + vitest 2 实测
 * `typeof window.localStorage === 'undefined'`），而全局 store 的 zustand
 * persist 依赖它 —— 浏览器里没问题，测试里会让一切触店的测试炸在
 * middleware.setItem 上。
 *
 * 用法：需要在测试文件里「第一个 import」本文件（ESM 侧 effect 按导入顺序
 * 执行，先装垫片再加载 gameStore / cheatRegistry）：
 *   import './localStorageShim';
 *   import { useGameStore } from '../../core/store/gameStore';
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
