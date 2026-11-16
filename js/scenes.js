// 战场场景 — 8 个主题。js/map.js 为已验证的场景提供独立地形布局。
//   · 地形骨架:tools/build_terrain.py 按 relief / rock 风格用 Blender 生成(外圈地形、岩石形状、裂隙表现各不相同)
//   · 皮肤:图像 AI 生成的无缝贴图(地面 / 岩壁 / 裂隙)+ 外圈装饰物 + 桌面背景,见 scene-handoff.md
//   · 缺图时回退到 palette 顶点色,8 个场景照样能区分
// 颜色都是 0..1 的 RGB。眼镜是光学透视的,暗色会变透明,所以 palette 都保持中高亮度。

export const SCENES = [
  {
    id: 'starcore', name: '星核荒原', en: 'Starcore Plateau', propKit: true,
    desc: '外星岩石高原,台阶状的平顶山环绕着一颗搏动的星核', descEn: 'An alien rock plateau ringed by terraced mesas',
    relief: 'mesa', rock: 'pillar', rimHeight: 1.0,
    palette: { near: [0.50, 0.56, 0.62], far: [0.64, 0.52, 0.48], rim: [0.42, 0.58, 0.46], cliff: [0.66, 0.56, 0.48],
      hazard: [0.52, 0.32, 0.86], hazardCore: [0.82, 0.62, 1.0], crystal: [0.55, 0.30, 1.0], rock: [0.62, 0.58, 0.56] },
    art: {
      ground: 'dusty grey-blue alien rock ground with fine cracks, small pebbles and faint patches of teal moss',
      cliff: 'layered sandstone cliff face with horizontal strata bands in warm tan and grey',
      hazard: 'glowing violet crystal shards packed tightly together, bright magenta-violet light between them',
      props: ['a cluster of tall glowing violet crystals', 'a weathered alien rock arch', 'a small flat-topped stone mesa with a crystal on top'],
      sky: 'an alien rocky plateau under a deep violet nebula sky with two moons',
    },
  },
  {
    id: 'glacier', name: '冰封裂谷', en: 'Frozen Rift', propKit: true,
    desc: '两侧转线口前后错开，外线经过减速冰缝，中路直通星核。',
    descEn: 'Staggered crossings connect the lanes. Outer routes pass slowing ice rifts. The middle leads to the star core.',
    menuPreview: 'assets/terrain/glacier/preview.png',
    relief: 'spires', rock: 'ice', rimHeight: 1.25,
    palette: { near: [0.78, 0.86, 0.94], far: [0.86, 0.84, 0.90], rim: [0.86, 0.92, 0.98], cliff: [0.60, 0.74, 0.88],
      hazard: [0.40, 0.72, 0.98], hazardCore: [0.75, 0.95, 1.0], crystal: [0.45, 0.85, 1.0], rock: [0.72, 0.84, 0.95] },
    art: {
      ground: 'packed snow and frosted ice ground with light blue tint, wind-swept snow ripples and small ice chunks',
      cliff: 'translucent glacier ice wall with deep blue cracks and white frost layers',
      hazard: 'cracked glowing blue ice with bright cyan light shining from deep crevasses below',
      props: ['a tall jagged ice spire', 'a frozen dead tree covered in frost', 'a pile of large blue ice blocks'],
      sky: 'a frozen glacier valley under a pale aurora-lit night sky',
    },
  },
  {
    id: 'volcano', name: '熔岩锻炉', en: 'Lava Forge', propKit: true,
    desc: '一条熔岩河横贯三路，地面单位蹚过会被烧灼;星核祭坛和两座冷却岩桥可安全通过。',
    descEn: 'A lava river cuts across all three lanes and burns ground units. The star-core altar and two cooled bridges are safe crossings.',
    relief: 'cones', rock: 'basalt', rimHeight: 1.35,
    palette: { near: [0.58, 0.46, 0.42], far: [0.66, 0.44, 0.38], rim: [0.56, 0.44, 0.40], cliff: [0.62, 0.40, 0.32],
      hazard: [0.98, 0.48, 0.16], hazardCore: [1.0, 0.82, 0.30], crystal: [1.0, 0.55, 0.15], rock: [0.56, 0.48, 0.46] },
    art: {
      ground: 'reddish-brown volcanic ash ground with cooled lava crust plates and thin glowing orange cracks (keep it mid-bright, not black)',
      cliff: 'hexagonal basalt column cliff in warm brown-grey with orange ember highlights in the cracks',
      hazard: 'bubbling molten lava surface, bright orange and yellow with darker red crust swirls',
      props: ['a small smoking volcano cone with glowing lava at the top', 'a cluster of hexagonal basalt columns', 'a glowing orange ember crystal formation'],
      sky: 'a volcanic landscape under a smoky orange-red sky with distant erupting volcanoes',
    },
  },
  {
    id: 'hive', name: '菌毯巢地', en: 'Hive Mire',
    desc: '虫群的老巢,大地覆盖着蠕动的菌毯,裂隙是冒泡的酸液池', descEn: 'The swarm homeland: living creep, fleshy mounds, bubbling acid pools',
    relief: 'mounds', rock: 'blob', rimHeight: 1.1,
    palette: { near: [0.58, 0.46, 0.66], far: [0.66, 0.44, 0.62], rim: [0.56, 0.42, 0.66], cliff: [0.62, 0.48, 0.70],
      hazard: [0.55, 0.88, 0.25], hazardCore: [0.82, 1.0, 0.45], crystal: [0.65, 1.0, 0.30], rock: [0.66, 0.52, 0.74] },
    art: {
      ground: 'organic violet creep mat with glossy veins and small glowing yellow-green spore dots',
      cliff: 'ridged violet chitin and fleshy organic wall with glossy segments and green bioluminescent spots',
      hazard: 'bubbling bright yellow-green acid pool with glossy bubbles and foam',
      props: ['a bulbous violet egg sac cluster glowing green inside', 'a tall curved chitin spike', 'a fleshy hive chimney with green glow'],
      sky: 'an alien swamp world covered in violet organic hive structures under a sickly green sky',
    },
  },
  {
    id: 'jungle', name: '玛雅遗迹', en: 'Maya Ruins',
    desc: '智械的故乡,丛林中的阶梯神庙遗迹,裂隙是碧绿的圣泉', descEn: 'The synthetics homeland: stepped temples in the jungle around turquoise cenotes',
    relief: 'ruins', rock: 'ruin', rimHeight: 1.15,
    palette: { near: [0.46, 0.62, 0.48], far: [0.56, 0.60, 0.44], rim: [0.36, 0.62, 0.40], cliff: [0.70, 0.70, 0.66],
      hazard: [0.20, 0.80, 0.80], hazardCore: [0.55, 1.0, 0.95], crystal: [0.25, 0.95, 1.0], rock: [0.74, 0.74, 0.70] },
    art: {
      ground: 'mossy jungle floor with grass, small leaves and scattered grey stone tiles carved with square spiral glyphs',
      cliff: 'ancient grey stone temple blocks carved with Maya-style square spiral glyphs, moss in the seams',
      hazard: 'clear glowing turquoise cenote water with light caustics and small lily pads',
      props: ['a small stepped stone pyramid ruin with glowing cyan glyphs', 'a broad jungle tree with a thick canopy', 'a carved stone totem pillar with a cyan glowing eye'],
      sky: 'a lush jungle with ancient stepped temples under a misty golden sky',
    },
  },
  {
    id: 'fortress', name: '钢铁要塞', en: 'Iron Bastion',
    desc: '联盟的前线要塞,铺着装甲板的阵地和城墙,裂隙是橙色的能量坑', descEn: 'An Alliance frontline: armored plating, bastion walls and glowing energy pits',
    relief: 'walls', rock: 'bunker', rimHeight: 0.95,
    palette: { near: [0.66, 0.68, 0.70], far: [0.72, 0.66, 0.62], rim: [0.62, 0.64, 0.66], cliff: [0.74, 0.72, 0.68],
      hazard: [0.98, 0.58, 0.20], hazardCore: [1.0, 0.85, 0.45], crystal: [1.0, 0.62, 0.20], rock: [0.80, 0.76, 0.70] },
    art: {
      ground: 'worn ivory and grey armored floor plates with rivets, hazard stripes worn away, small scratches',
      cliff: 'thick ivory concrete bastion wall with orange warning lights and navy blue metal trim',
      hazard: 'a glowing orange energy grid pit with bright hexagonal light cells',
      props: ['a sandbag barricade with a small orange beacon light', 'a tall radio antenna tower with orange lights', 'a stack of ivory supply crates with navy blue straps'],
      sky: 'a fortified military base on a plateau under a clear blue evening sky with searchlights',
    },
  },
  {
    id: 'abyss', name: '混沌深渊', en: 'Chaos Abyss',
    desc: '混沌的领域,破碎的骨石悬浮在空中,裂隙是紫色的虚空裂口', descEn: 'The chaos realm: shattered bone-stone floating over violet void rifts',
    relief: 'shards', rock: 'shard', rimHeight: 1.3,
    palette: { near: [0.66, 0.60, 0.56], far: [0.70, 0.58, 0.60], rim: [0.62, 0.54, 0.62], cliff: [0.72, 0.64, 0.58],
      hazard: [0.62, 0.30, 0.86], hazardCore: [0.40, 1.0, 0.55], crystal: [0.35, 1.0, 0.55], rock: [0.76, 0.68, 0.62] },
    art: {
      ground: 'cracked pale beige bone-stone ground with thin glowing toxic green veins in the cracks',
      cliff: 'jagged broken violet stone and pale bone fragments with glowing green cracks',
      hazard: 'a swirling violet void rift with green ghost-fire sparks and floating stone debris (bright, not black)',
      props: ['a floating jagged bone-stone shard with green glowing cracks', 'a horned stone obelisk with green runes', 'a broken carved stone face half buried'],
      sky: 'a shattered realm of floating rocks over a glowing violet void with green ghost fire',
    },
  },
  {
    id: 'desert', name: '沙海遗迹', en: 'Sand Sea',
    desc: '无尽的沙海,平滑的沙丘间立着风化的砂岩拱门,裂隙是吞人的流沙', descEn: 'An endless sand sea of smooth dunes, sandstone arches and quicksand',
    relief: 'dunes', rock: 'sandstone', rimHeight: 0.9,
    palette: { near: [0.80, 0.70, 0.52], far: [0.86, 0.66, 0.48], rim: [0.86, 0.72, 0.52], cliff: [0.80, 0.58, 0.42],
      hazard: [0.70, 0.56, 0.38], hazardCore: [0.92, 0.80, 0.55], crystal: [1.0, 0.85, 0.40], rock: [0.82, 0.62, 0.46] },
    art: {
      ground: 'warm golden desert sand with soft wind ripples and a few small pebbles',
      cliff: 'wind-eroded red sandstone rock with smooth flowing layers',
      hazard: 'swirling quicksand vortex in darker golden sand with sinking ripples',
      props: ['a wind-eroded red sandstone arch', 'a half buried ancient stone statue head', 'a cluster of desert cactus-like alien plants'],
      sky: 'golden sand dunes stretching to the horizon under a hot hazy sky with a large pale planet',
    },
  },
];

export const SCENE_IDS = SCENES.map(s => s.id);
export const sceneById = id => SCENES.find(s => s.id === id) || SCENES[0];
// 菜单和随机匹配只选择已开放的场景。其余主题继续用于预览与美术验收。
export const PLAYABLE_IDS = ['starcore', 'glacier', 'volcano'];
export const randomScene = () => PLAYABLE_IDS[Math.floor(Math.random() * PLAYABLE_IDS.length)];
