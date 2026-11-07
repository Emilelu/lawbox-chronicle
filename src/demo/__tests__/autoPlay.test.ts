/**
 * 自动演示（autoplay）纯逻辑单测 —— URL 参数解析与演示角色。
 */

import { describe, expect, it } from 'vitest';
import { demoPlayer, readAutoPlayConfig } from '../autoPlay';

describe('autoplay —— 配置解析', () => {
  it('只有 autoplay=1 才启用', () => {
    expect(readAutoPlayConfig('?autoplay=1').enabled).toBe(true);
    expect(readAutoPlayConfig('?autoplay=0').enabled).toBe(false);
    expect(readAutoPlayConfig('?foo=1').enabled).toBe(false);
    expect(readAutoPlayConfig('').enabled).toBe(false);
  });

  it('速度夹在 0.5~5，非法值回退 1', () => {
    expect(readAutoPlayConfig('?autoplay=1&speed=3').speed).toBe(3);
    expect(readAutoPlayConfig('?autoplay=1&speed=99').speed).toBe(5);
    expect(readAutoPlayConfig('?autoplay=1&speed=0.1').speed).toBe(0.5);
    expect(readAutoPlayConfig('?autoplay=1&speed=abc').speed).toBe(1);
  });
});

describe('autoplay —— 演示角色', () => {
  it('满武器、高攻高血、武器已装备', () => {
    const p = demoPlayer();
    expect(p.weapons?.length ?? 0).toBeGreaterThan(0);
    expect(p.baseAttack).toBeGreaterThan(1000);
    expect(p.hp).toBe(p.maxHp);
    expect(p.weaponId).not.toBeNull();
  });
});
