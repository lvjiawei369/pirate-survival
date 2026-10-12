// 物品、配方、船只修复阶段和任务目标。数值集中在这里，方便调平衡。
export const ITEMS = {
  wood: { name: '木材', icon: '🪵' },
  stone: { name: '石块', icon: '🪨' },
  leaf: { name: '叶片', icon: '🍃' },
  rope: { name: '绳子', icon: '➰' },
  coconut: { name: '椰子', icon: '🥥' },
  fish: { name: '生鱼', icon: '🐟' },
  claw: { name: '蟹钳', icon: '🦀' },
  roast: { name: '烤椰肉', icon: '🍢' },
  grilledFish: { name: '烤鱼', icon: '🍡' },
  grilledClaw: { name: '烤蟹钳', icon: '🍗' },
  soup: { name: '椰汁鱼汤', icon: '🍲' },
  shell: { name: '贝壳', icon: '🐚' },
  plank: { name: '木板', icon: '🟫' },
  sail: { name: '补丁帆', icon: '⛵' },
  tentkit: { name: '帐篷包', icon: '⛺' },
  shard: { name: '罗盘碎片', icon: '🧭', key: true },
  seedPotato: { name: '番薯苗', seed: 'potato' },
  seedTomato: { name: '番茄籽', seed: 'tomato' },
  seedMelon: { name: '西瓜籽', seed: 'melon' },
  sweetPotato: { name: '番薯' },
  tomato: { name: '番茄' },
  watermelon: { name: '西瓜' },
  roastPotato: { name: '烤番薯' },
  sword: { name: '木弯刀', icon: '🗡️', tool: true },
  axe: { name: '石斧', icon: '🪓', tool: true },
  rod: { name: '钓竿', icon: '🎣', tool: true },
  hoe: { name: '锄头', tool: true },
  can: { name: '水壶', tool: true }
};

// station: null = 随身制作；'bench' 工作台；'fire' 营火（cook = 烹饪秒数，烤好自动进背包）
export const RECIPES = [
  { id: 'rope', out: 'rope', n: 1, cost: { leaf: 3 }, station: null, desc: '搓成的绳子，修船和工具都要用' },
  { id: 'sword', out: 'sword', n: 1, cost: { wood: 3, rope: 1 }, station: 'bench', desc: '攻击力 ×2，攻击距离更远', once: true },
  { id: 'axe', out: 'axe', n: 1, cost: { wood: 2, stone: 2, rope: 1 }, station: 'bench', desc: '可以砍棕榈树，得到木材、叶片和椰子', once: true },
  { id: 'rod', out: 'rod', n: 1, cost: { wood: 2, rope: 2 }, station: 'bench', desc: '在有鱼影的水边按 E 钓鱼', once: true },
  { id: 'hoe', out: 'hoe', n: 1, cost: { wood: 2, stone: 1, rope: 1 }, station: 'bench', desc: '开垦田地：在平坦的草地上按 E', once: true },
  { id: 'can', out: 'can', n: 1, cost: { wood: 1, shell: 2, rope: 1 }, station: 'bench', desc: '给庄稼浇水（下雨天会自动浇）', once: true },
  { id: 'plank', out: 'plank', n: 1, cost: { wood: 3 }, station: 'bench', desc: '修补船壳用的木板' },
  { id: 'sail', out: 'sail', n: 1, cost: { leaf: 4, rope: 2, shell: 2 }, station: 'bench', desc: '贝壳压边的补丁帆' },
  { id: 'tentkit', out: 'tentkit', n: 1, cost: { wood: 4, leaf: 6, rope: 2 }, station: 'bench', desc: '按 B 搭在平地上：能睡觉、复活点、存档' },
  { id: 'roast', out: 'roast', n: 1, cost: { coconut: 1 }, station: 'fire', cook: 4, desc: '饱腹 +45，生命 +20' },
  { id: 'grilledFish', out: 'grilledFish', n: 1, cost: { fish: 1 }, station: 'fire', cook: 5, desc: '饱腹 +35，生命 +25' },
  { id: 'grilledClaw', out: 'grilledClaw', n: 1, cost: { claw: 1 }, station: 'fire', cook: 4, desc: '饱腹 +30，90 秒内体力恢复加快' },
  { id: 'roastPotato', out: 'roastPotato', n: 1, cost: { sweetPotato: 1 }, station: 'fire', cook: 5, desc: '饱腹 +50，生命 +15' },
  { id: 'soup', out: 'soup', n: 1, cost: { fish: 2, coconut: 1 }, station: 'fire', cook: 8, desc: '饱腹 +70，生命 +40，3 分钟不怕冷' }
];

// buff: strong = 体力恢复 ×1.6；warm = 不会着凉
export const FOOD = {
  coconut: { hunger: 20, hp: 0 },
  fish: { hunger: 8, hp: 0 },
  roast: { hunger: 45, hp: 20 },
  grilledFish: { hunger: 35, hp: 25 },
  grilledClaw: { hunger: 30, hp: 10, buff: ['strong', 90] },
  soup: { hunger: 70, hp: 40, buff: ['warm', 180] },
  tomato: { hunger: 12, hp: 8 },
  watermelon: { hunger: 30, hp: 15, buff: ['strong', 60] },
  sweetPotato: { hunger: 10, hp: 0 },
  roastPotato: { hunger: 50, hp: 15 }
};
// F 键默认吃的顺序
export const EAT_ORDER = ['grilledFish', 'roastPotato', 'roast', 'grilledClaw', 'watermelon', 'tomato', 'soup', 'coconut', 'fish', 'sweetPotato'];
// 作物：生长所需游戏小时（只在浇过水时生长），收获数量
export const CROPS = {
  potato: { name: '番薯', seed: 'seedPotato', out: 'sweetPotato', hours: 10, yield: [2, 4] },
  tomato: { name: '番茄', seed: 'seedTomato', out: 'tomato', hours: 8, yield: [3, 5] },
  melon: { name: '西瓜', seed: 'seedMelon', out: 'watermelon', hours: 14, yield: [1, 2] }
};

export const BOAT_STAGES = [
  { id: 'hull', name: '修补船壳', cost: { plank: 4, rope: 1 } },
  { id: 'rig', name: '竖起桅杆和帆', cost: { sail: 1, rope: 1 } },
  { id: 'compass', name: '装上罗盘碎片', cost: { shard: 1 } }
];

export const STATIONS = { bench: '工作台', fire: '营火' };
