/**
 * 生成全方位游戏文档 HTML（一次性脚本；数据变更后重跑刷新）。
 * 用法：npx vite-node scripts/genGameDocs.ts
 * 产物：docs/game-guide.html（自包含单文件，双击即可打开，无需服务器）
 * 内容与游戏内攻略面板共用 buildLevelGuide（单一真相）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { AREA_LEVELS } from '../src/data/levels/areas';
import { buildLevelGuide } from '../src/data/levels/levelGuide';
import { LAW_CARDS } from '../src/data/cards/lawCards';
import { CHARACTER_CARDS } from '../src/data/cards/characterCards';
import { WEAPONS } from '../src/data/weapons';
import { ENEMIES } from '../src/data/enemies';
import { FORMAL_POOL } from '../src/data/gacha/pools';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const table = (headers: string[], rows: string[][]): string =>
  `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;

/* ============================== 1. 操作键位 ============================== */
const CONTROLS: Array<[string, string]> = [
  ['W / ↑', '向上移动 / 推箱'],
  ['S / ↓', '向下移动 / 推箱'],
  ['A / ←', '向左移动 / 推箱'],
  ['D / →', '向右移动 / 推箱'],
  ['V', '第一 / 第三人称视角切换（任意相位可用）'],
  ['T（按住）', '第一人称俯瞰：临时战术视角，松开自动恢复'],
  ['Y / U / B / N', '斜向推挤（需法则卡「斜向推挤」）'],
  ['Shift + 方向', '镜像拉箱：后退一格箱子跟进（需「镜像拉箱」）'],
  ['C', '相位穿行：消耗充能穿过一格障碍（需「相位穿行」）'],
  ['F', '阴阳位面切换（需「位面通行」；「位面之眼」可任意位置切）'],
  ['E', '交互：星愿祭坛抽卡 / 剧情物件'],
  ['Tab', '战斗布阵确认；平时打开卡组面板'],
  ['Z', '撤销上一步（含被消除的箱子）'],
  ['Q', '重玩本段'],
  ['M', '静音开关'],
  ['Enter / Space', '推进对话'],
  ['Esc', '关闭浮层（终局也不锁死）'],
  ['`（反引号）', 'META 终端（通关全部主线后解锁）'],
];

/* ============================== 2. 武器/敌人 ============================= */
const weaponRows = WEAPONS.map((w) => [esc(w.name), String(w.attack), esc(w.description)]);
const enemyRows = ENEMIES.map((e) => [
  esc(e.name),
  String(e.maxHp),
  String(e.attack),
  String(e.defense),
  e.boss ? 'BOSS' : '小怪',
  esc(`掉落：${ENEMIES.find((x) => x.id === e.dropWeaponId)?.name ?? '—'}`),
]);

/* ============================== 3. 卡牌表 ================================ */
const cardRows = [
  ...LAW_CARDS.map((c) => [`${c.rarity}★`, esc(c.name), esc(c.description)]),
  ...CHARACTER_CARDS.map((c) => [`${c.rarity}★`, esc(c.name), esc('携带后为战斗提供增益 buff（详见卡面）')]),
].sort((a, b) => b[0].localeCompare(a[0]));

/* ============================== 4. 每关攻略 ============================== */
const levelSections = AREA_LEVELS.map((lv) => {
  const g = buildLevelGuide(lv.id);
  const pushList = g.pushes
    .map((p) => `<li><b class="arrow">${p.arrow}</b> ${esc(p.label)}${p.isFall ? ' <b class="fall">（坠落）</b>' : ''}</li>`)
    .join('');
  const mechanics = g.mechanics.map((m) => `<li>${esc(m)}</li>`).join('');
  // twist 段：与游戏内攻略面板置顶行同一份 LEVEL_TWISTS 文案（数据层唯一文字源）
  const twist = g.twist !== null ? `<p class="twist">✦ <b>本关新机制</b>：${esc(g.twist)}</p>` : '';
  const gate = g.gateHint !== null ? `<p class="gate">🎫 ${esc(g.gateHint)}</p>` : '';
  return `
  <section class="level" id="${esc(lv.id)}">
    <h3>${esc(lv.name)} <small>${esc(lv.subtitle)}</small></h3>
    <p class="chips">
      <span class="chip gold">★★★ ≤ ${g.stars.three} 步</span>
      <span class="chip">★★ ≤ ${g.stars.two} 步</span>
      <span class="chip cyan">奖励 ${esc(g.rewardText)}</span>
    </p>
    ${twist}
    <ul>${mechanics}</ul>
    ${gate}
    <details><summary>展开参考推法（${g.pushes.length} 推 · 剧透）</summary><ol>${pushList}</ol>
    <p class="note">${esc(g.note)}</p></details>
  </section>`;
}).join('\n');

/* ============================== 5. 页面骨架 ============================== */
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>《法则箱庭异闻录》全方位游戏文档</title>
<style>
  :root { --bg:#0a0e1e; --panel:#121830; --ink:#e6e9f5; --dim:#8b93b8; --cyan:#00e5ff; --gold:#ffcf5c; --violet:#7c5cff; --rose:#ff5c9e; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif; line-height:1.7; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 32px 20px 80px; }
  header { text-align:center; padding: 36px 0 8px; }
  h1 { font-size: clamp(28px, 5vw, 44px); letter-spacing: .14em; margin: 8px 0 4px; color: var(--cyan); text-shadow: 0 0 18px rgba(0,229,255,.35); }
  .tagline { color: var(--dim); letter-spacing: .3em; font-size: 13px; }
  .badges { margin-top: 12px; }
  .badges span { display:inline-block; border:1px solid rgba(124,92,255,.5); border-radius:999px; padding:2px 12px; font-size:12px; margin:4px; color:var(--dim); }
  h2 { font-size: 22px; margin: 42px 0 12px; padding-left: 12px; border-left: 4px solid var(--violet); letter-spacing: .1em; }
  h3 { font-size: 17px; margin: 20px 0 6px; color: var(--gold); }
  h3 small { color: var(--dim); font-size: 12px; font-weight: 400; margin-left: 8px; }
  p, li { font-size: 14.5px; }
  a { color: var(--cyan); }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 13.5px; }
  th, td { border: 1px solid rgba(139,147,184,.25); padding: 6px 10px; text-align: left; }
  th { background: rgba(124,92,255,.15); color: var(--cyan); }
  tr:nth-child(even) td { background: rgba(255,255,255,.02); }
  ul, ol { margin: 8px 0; padding-left: 22px; }
  .chip { display:inline-block; border:1px solid rgba(139,147,184,.4); border-radius:999px; padding:1px 10px; font-size:12px; margin:2px 2px; }
  .chip.gold { color: var(--gold); border-color: rgba(255,207,92,.5); }
  .chip.cyan { color: var(--cyan); border-color: rgba(0,229,255,.5); }
  .level { background: var(--panel); border: 1px solid rgba(124,92,255,.35); border-radius: 12px; padding: 14px 18px; margin: 14px 0; }
  details { border: 1px dashed rgba(139,147,184,.4); border-radius: 8px; padding: 8px 12px; margin: 10px 0; }
  summary { cursor: pointer; color: var(--gold); font-size: 13.5px; }
  .arrow { color: var(--cyan); font-size: 15px; }
  .fall { color: var(--rose); }
  .gate { border:1px dashed rgba(255,207,92,.5); border-radius:8px; padding:6px 10px; font-size:13px; }
  .twist { border:1px solid rgba(124,92,255,.45); background:rgba(124,92,255,.08); border-radius:8px; padding:6px 10px; font-size:13.5px; }
  .note { color: var(--dim); font-size: 12px; }
  .warn { color: var(--rose); font-size: 12.5px; }
  code, kbd { background: rgba(0,229,255,.08); border: 1px solid rgba(0,229,255,.25); border-radius: 5px; padding: 0 6px; font-size: 12.5px; }
  nav { display:flex; flex-wrap:wrap; gap:8px; margin: 14px 0; }
  nav a { font-size: 13px; text-decoration: none; border: 1px solid rgba(139,147,184,.35); border-radius: 999px; padding: 3px 12px; }
  .top { text-align:right; margin-top: -8px; }
  .top a { font-size: 12px; color: var(--dim); }
</style>
</head>
<body>
<div class="wrap">

<header>
  <div class="chip cyan">推箱 × 回合战斗 × 法则抽卡</div>
  <h1>法则箱庭异闻录</h1>
  <p class="tagline">LAWBOX CHRONICLE · 三款远古小游戏融合重制</p>
  <div class="badges">
    <span>React 18 + TypeScript strict</span><span>Vite 5</span><span>three.js / React-Three-Fiber 3D</span>
    <span>zustand</span><span>framer-motion</span><span>howler.js</span><span>vitest 全量回归门禁</span>
  </div>
</header>

<nav>
  <a href="#overview">游戏概览</a><a href="#controls">操作键位</a><a href="#systems">核心系统</a>
  <a href="#cards">卡池与卡牌</a><a href="#units">武器与敌人</a><a href="#levels">十二关攻略</a>
  <a href="#eggs">彩蛋与隐藏内容</a><a href="#run">运行与构建</a><a href="#license">来源与许可</a>
</nav>

<h2 id="overview">游戏概览</h2>
<p>《法则箱庭异闻录》把三款远古小游戏融成了一款全新的机制级融合游戏：</p>
<ul>
  <li><b>《鬼畜大冒险》</b>（Java 文字冒险）——剧情、角色、遭遇战、作者谜题与 BOSS 战，升级为 3D 场景里可移动探索、对话框演出的完整主线；</li>
  <li><b>《三B推箱子》</b>（HTML+CSS+JS）——推箱关卡玩法升级为立体高度层 3D，箱子可推落高台砸压守卫；</li>
  <li><b>《邦邦抽卡模拟器》</b>（Java）——抽卡系统成为玩法闭环：推箱赚星石 → 抽卡出「法则卡」→ 法则实时改写推箱规则与战斗数值。</li>
</ul>
<p>玩法循环：<b>推箱过关 → 星级结算星石 → 星愿祭坛抽卡 → 法则卡改写规则 → 更短的推路 / 更强的战斗 → 挑战更高星与隐藏内容</b>。三个老项目的全部 43 个已知 bug 与 24 项未完成功能在重制时逐一处理，并新增立体高度、阴阳位面、相位穿行、法则卡改写、无尽回廊、档案收集等 8 类新玩法。</p>

<h2 id="controls">操作键位</h2>
<p>键位唯一来源 <code>src/input/useKeyActions.ts</code>；触屏端有十字键 + 滑动手势，语义与键盘一致。</p>
${table(['按键', '作用'], CONTROLS.map(([k, v]) => [`<kbd>${esc(k)}</kbd>`, esc(v)]))}

<h2 id="systems">核心系统</h2>
<h3>推箱（立体高度层）</h3>
<ul>
  <li>把所有箱子推上旗位基座（■）即过关；步数决定星级（每关 3★ / 2★ 两档步数线）。</li>
  <li>立体关卡存在<b>高度层</b>：爬升有上限（CLIMB_LIMIT），把箱子推下高台会<b>坠落砸压</b>下方的守卫或目标——地形本身是武器。</li>
  <li><b>尖刺格</b>：战斗布阵期可把敌人推进尖刺按比例扣血。</li>
  <li><b>阴阳位面</b>：按 <kbd>F</kbd> 切换表里世界，阴面有另一套地形与浮空石板（需「位面通行」法则卡）。</li>
  <li><b>撤销（Z）</b>可回滚任意步，含被消除的箱子；<b>死锁检测</b>会在无解局面时提示。</li>
</ul>
<h3>回合战斗（布阵推挤）</h3>
<ul>
  <li>踩到敌人触发遭遇战：先<b>布阵</b>——怪物方块化（重量∝HP）摆上 3D 战场网格，可用方向键/屏幕键<b>推挤</b>。</li>
  <li>推下深渊、推进尖刺按比例扣血甚至秒杀小怪；BOSS 免疫推挤（附护盾与弱点机制），必须走公式战。</li>
  <li>伤害 = 攻 − 防（下限 0），武器提供攻击加成，部分武器有特殊效果（击退 / 多次使用）。</li>
</ul>
<h3>抽卡与法则卡</h3>
<ul>
  <li>星石来源：关卡星级结算 / 挑战层 / 剧情。定价：单抽 100◈、十连 900◈。</li>
  <li>概率：4★ 6% / 3★ 26% / 2★ 68%（逐卡独立 roll，概率公示面板可查）。</li>
  <li>三层保底：①十连末位必 3★+；②累计 50 抽必出 4★；③累计 40 抽未获未持有法则卡 → 定向补齐。</li>
  <li>重复法则卡自动转 <b>20 碎片</b>；<b>60 碎片</b>可在卡组·商店页签直购任一未持有法则卡——零软锁。</li>
  <li><b>法则卡</b>是核心融合玩法：激活后实时改写推箱物理与战斗参数（羽箱减重、推程+1、镜像拉箱、斜向推挤、相位穿行、箱落引爆、位面之眼……）。</li>
  <li>怀旧对照池：完整复刻原邦邦抽卡模拟器的概率缺陷，作为「概率展品」与正式池并列，档案页可一键跑对照十连并查看双池实测出货曲线。</li>
</ul>
<h3>收集与存档</h3>
<ul>
  <li>档案面板：卡牌图鉴（首获/次数）、成就、双池出货实测曲线、逐抽记录。</li>
  <li>存档为 localStorage 三分片（进度/偏好、档案、抽卡统计），刷新与关浏览器都不丢；标题页可重置。</li>
</ul>

<h2 id="cards">卡池与卡牌</h2>
${table(['稀有度', '名称', '效果 / 说明'], cardRows)}
<p class="note">法则卡一卡一补丁：激活即注入对应规则补丁；卡面稀有度与补丁稀有度一致，卡池概率与原作参数保真并有审计断言。</p>

<h2 id="units">武器与敌人</h2>
<h3>武器</h3>
${table(['名称', '攻击加成', '说明'], weaponRows)}
<h3>敌人</h3>
${table(['名称', 'HP', '攻击', '防御', '类型', '备注'], enemyRows)}

<h2 id="levels">十二关攻略</h2>
<p>以下攻略由游戏内置求解器离线求得并逐格回放验证，与游戏内「💡 攻略」面板同一份数据。每关先给机制提示，推法默认折叠防剧透。</p>
${levelSections}

<h2 id="eggs">彩蛋与隐藏内容</h2>
<ul>
  <li><b>四导航天使</b>：主城第一步无论朝哪都会遇到一位（原版「其余瞬间去世」保留为「残留的羽毛」彩蛋）。</li>
  <li><b>越界四方向</b>：主城边缘向外走——北=时空裂缝进隐藏关；东=神秘法阵传送（可进无尽回廊）；南/西=反转为高难挑战层「深渊坠道」「E N D 之壁」。</li>
  <li><b>无尽回廊</b>：程序生成关卡，逆向拉箱构造保证可解，生成后仍经求解器+逐格回放双闸门校验。</li>
  <li><b>作者谜题</b>：集齐三小怪击杀后到作者处答题（答案 x−y=(D−1)−z 的原作谜题），答对 BOSS 攻击归零并获得弱点钥匙——原作答错即死的设定改成了阶梯提示+重试。</li>
  <li><b>三种作弊入口</b>（设置开启作弊 / 标题页连点 20 次）：K 消箱、G 墙皮重掷（原 V 键位已改为视角切换）、] [ 选关跳转、META 终端指令等——所有入口共用同一张命令表与解锁门，热键无特权。</li>
  <li><b>隐藏关与真结局</b>（剧透）：<details><summary>展开</summary>北越界进入隐藏关，复刻原作 EasterEgg：/kill--SetName、w/w/s/s、adad、BABA、/give 三武装、Base64 提示……最终以 <code>/kill--%^%&amp;62*^*&amp;^@&amp;*</code> 拒绝剧本，达成真结局「拒绝剧本的人」并解锁 META 终端常驻。</details></li>
</ul>

<h2 id="run">运行与构建</h2>
<pre style="background:var(--panel);border:1px solid rgba(124,92,255,.35);border-radius:10px;padding:14px 18px;font-size:13px;">
npm install        # 安装依赖
npm run dev        # 开发服务器（默认 :5173）
npm run demo       # 自动通关演示（起服务并打开 /?autoplay=1）
npm run build      # tsc -b &amp;&amp; vite build（纯静态产物 dist/）
npm run test       # vitest run（全量回归门禁）
npm run preview    # 预览构建产物
</pre>
<p>自动演示：内置求解器逐关自动推箱 + 剧情巡游（天使/小怪/作者/BOSS/彩蛋），可加 <code>&amp;speed=2</code> 调速（0.5~5）；顶栏随时可停，演示使用临时角色，结束自动恢复你的存档。</p>

<h2 id="license">来源与许可</h2>
<ul>
  <li><b>KichikuAdventure</b>（Java 文字冒险，GPL-3.0）——剧情/角色/数值/BGM（.mid 经 FluidSynth + GeneralUser GS 转码）；</li>
  <li><b>SanBPushChest</b>（HTML 推箱子，GPL-3.0）——关卡与 32 张贴图、20 个音效；</li>
  <li><b>BandoriLotteryEmulator</b>（Java 抽卡，概率模型完整复刻）——bgm.mp3 取自 BanG Dream 官方专辑，<b class="warn">上架前必须替换或取得授权</b>。</li>
</ul>
<p class="note">本文档由 <code>scripts/genGameDocs.ts</code> 从游戏数据自动生成（与游戏内攻略面板同源）；数据变更后重跑 <code>npx vite-node scripts/genGameDocs.ts</code> 即可刷新。</p>

<p class="top"><a href="#overview">▲ 回到顶部</a></p>
</div>
</body>
</html>
`;

mkdirSync('docs', { recursive: true });
writeFileSync('docs/game-guide.html', html);
console.log(`written docs/game-guide.html (${Math.round(html.length / 1024)} KB)`);
