"""飞行牌翅膀骨骼动画:给 Tripo 刚体模型(虚空蝠 / 飞翼虫)搭翅膀骨骼 + 蒙皮 + 程序化 K 帧,导出带动画的 glb。

用法(可重跑:输入原始无骨 glb → 输出新 glb;原 glb 请先自行备份):
  "C:/Program Files/Blender Foundation/Blender 4.5/blender.exe" -b --factory-startup \
      -P tools/blender/wing_anim.py -- <模型 id> <输入.glb> <输出.glb> [报告.json] [预览前缀]
  模型 id:chaos_bats | swarm_flyer(参数见下方 MODELS)
  报告.json:量出来的翼根 / 翼肘 / 翼尖位置、各骨骼权重统计、导出前后三角面数(可选)
  预览前缀:给出时额外渲染 Workbench 预览图(<前缀>_weights.png 权重着色、<前缀>_fly.png 扇翅多帧)

坐标约定(Blender 导入 glTF 之后):+X = 模型正面(models.json 的 yaw -90° 把它转到游戏里的前进方向),
+Z = 上,+Y = 模型自己的左边。所有动作先按「左翼(+Y)」在骨架空间里写,右翼用镜像四元数(w,-x,y,-z)。
骨骼局部轴不靠猜:骨架空间旋转 q 换到骨骼局部 = R_rest⁻¹ · q · R_rest(R_rest = bone.matrix_local)。

两种翅膀:
  - 蝙蝠(膜翼,连在身体两侧):每侧两节(上臂 + 前臂/指),权重按到身体中线的距离 |Y| 平滑过渡,
    纯位置函数 → Tripo 网格按 UV 缝切开的重合顶点权重一致,不会裂缝。脚爪(身体下方)强制归身体。
  - 飞翼虫(硬翅,前后两对):每片翅膀一根骨,按网格连通块(岛)分类后整块刚性跟骨,身体不受影响。
"""
import bpy, bmesh, sys, json, math, os
from mathutils import Vector, Quaternion, Matrix

FPS = 60

# ── 每个模型的参数(长度单位 = 模型原始单位,即 glb 里的坐标)──
MODELS = {
    'chaos_bats': {
        'kind': 'membrane',
        'root_y': 0.10,        # 身体半宽:|Y| 小于它全归身体(正面图量出身体 / 头 / 耳都在 ±0.10 内)
        'root_fade': 0.07,     # 翼根权重从 root_y 起在这段距离内由 0 过渡到 1(膜翼根部柔和弯折)
        'elbow_t': 0.5,        # 翼肘在翼展上的比例(上臂 / 前臂分界)
        'elbow_fade': 0.05,    # 上臂 ↔ 前臂权重过渡半宽
        'feet_z': (-0.16, -0.11),   # 身体下方的脚爪:z 低于前者全归身体,高于后者不受限(只在 |Y|<0.22 内生效)
        'period': 0.5,         # fly 一拍(秒)
        'flap_up': 38, 'flap_down': 34,   # 上扬 / 下扑角(度,绕前进轴)
        'sweep': 26,           # 前后扫(度,绕竖直轴):下扑时翼尖往前兜风,上抬时往后收
        'outer_gain': 0.55, 'outer_lag': 0.09,   # 前臂相对上臂再多扇的比例、相位滞后(鞭梢感)
        'fold': 22,            # 上抬时前臂往回收的角度(度)
        'bob': 0.018,          # 身体随扇翅起伏(下扑时被托起)
        'attack_dash': 0.16, 'attack_pitch': 28,
        'die_drop': 0.6,
    },
    'swarm_flyer': {
        'kind': 'rigid',
        'period': 0.4,
        'flap_up': 22, 'flap_down': 40,
        'sweep': 18,
        'hind_gain': 0.85, 'hind_lag': 0.12,   # 后翅幅度 / 相位滞后(前后翅不同步,昆虫感)
        'bob': 0.014,
        'attack_dash': 0.14, 'attack_pitch': 32,
        'die_drop': 0.6,
    },
}

UP, FWD = Vector((0, 0, 1)), Vector((1, 0, 0))


def smoothstep(a, b, x):
    if a == b:
        return 1.0 if x >= b else 0.0
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def ease(t):  # 两端导数为 0 的余弦缓动
    return (1 - math.cos(math.pi * max(0.0, min(1.0, t)))) / 2


def flap_wave(p, up, down, down_frac=0.4):
    """扇翅角(度):p∈[0,1) 一拍;p=0 翅膀在最高点,下扑占 down_frac(快),上抬占其余(慢)。两端导数 0,首尾闭合。"""
    p %= 1.0
    if p < down_frac:
        return up + (-down - up) * ease(p / down_frac)
    return -down + (up + down) * ease((p - down_frac) / (1 - down_frac))


def qaxis(axis, deg):
    return Quaternion(axis, math.radians(deg))


def mirror_q(q):  # 关于 XZ 平面(左右)镜像
    return Quaternion((q.w, -q.x, q.y, -q.z))


# ─────────────────────────── 导入 + 量体 ───────────────────────────

def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    assert len(meshes) == 1, f'期望 1 个网格,实际 {len(meshes)}'
    mesh = meshes[0]
    assert mesh.matrix_world == Matrix.Identity(4), '网格节点带变换,量体坐标会错'
    return mesh


def islands(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    comp = [-1] * len(bm.verts)
    out = []
    for v in bm.verts:
        if comp[v.index] >= 0:
            continue
        cid, stack, idx = len(out), [v], []
        comp[v.index] = cid
        while stack:
            a = stack.pop()
            idx.append(a.index)
            for e in a.link_edges:
                b = e.other_vert(a)
                if comp[b.index] < 0:
                    comp[b.index] = cid
                    stack.append(b)
        out.append(idx)
    bm.free()
    return out


def median(vals):
    s = sorted(vals)
    return s[len(s) // 2] if s else 0.0


def slice_center(verts, y0, half=0.02):
    """|Y| 在 y0±half 这一条里的翅膀顶点 (x,z) 中位数(左右两侧合并 → 天然对称)。"""
    pts = [v for v in verts if abs(abs(v.y) - y0) <= half]
    return Vector((median([p.x for p in pts]), y0, median([p.z for p in pts]))), len(pts)


def measure_membrane(mesh, cfg):
    vs = [v.co.copy() for v in mesh.data.vertices]
    wing = [v for v in vs if abs(v.y) > cfg['root_y'] and not (v.z < cfg['feet_z'][1] and abs(v.y) < 0.22)]
    span = max(abs(v.y) for v in vs)
    root, n0 = slice_center(wing, cfg['root_y'] + 0.01)
    elbow_y = cfg['root_y'] + (span - cfg['root_y']) * cfg['elbow_t']
    elbow, n1 = slice_center(wing, elbow_y)
    tip, n2 = slice_center(wing, span - 0.03, 0.03)
    tip.y = span
    return {'root': root, 'elbow': elbow, 'tip': tip, 'span': span, 'samples': [n0, n1, n2]}


def classify_rigid(mesh):
    """飞翼虫:按网格岛分类前翅 / 后翅 / 身体。翅膀是 X 向很薄、在胸部上方往两侧伸的片。"""
    me = mesh.data
    labels = [None] * len(me.vertices)
    stats = {'fore': 0, 'hind': 0, 'body': 0}
    for isl in islands(me):
        cs = [me.vertices[i].co for i in isl]
        c = sum(cs, Vector()) / len(cs)
        xs = [p.x for p in cs]
        thin = max(xs) - min(xs) < 0.11
        is_wing = thin and -0.04 < c.x < 0.11 and abs(c.y) > 0.10 and c.z > 0.07 and max(abs(p.y) for p in cs) > 0.15
        lab = 'body'
        if is_wing:
            lab = 'fore' if c.z > 0.10 + 0.25 * abs(c.y) else 'hind'
        for i in isl:
            labels[i] = (lab, 1 if c.y > 0 else -1)
        stats[lab] += len(isl)
    return labels, stats


def measure_rigid(mesh, labels):
    """每片翅膀的翼根(离中线最近的 6% 顶点质心)和翼尖(离翼根最远的 6% 顶点质心);左右按镜像平均。"""
    me = mesh.data
    out = {}
    for part in ('fore', 'hind'):
        pts = [Vector((v.co.x, abs(v.co.y), v.co.z)) for v, l in zip(me.vertices, labels) if l[0] == part]
        pts.sort(key=lambda p: p.y)
        n = max(3, len(pts) * 6 // 100)
        root = sum(pts[:n], Vector()) / n
        far = sorted(pts, key=lambda p: (p - root).length)[-n:]
        tip = sum(far, Vector()) / n
        out[part] = {'root': root, 'tip': tip, 'count': len(pts)}
    return out


# ─────────────────────────── 搭骨 + 蒙皮 ───────────────────────────

def build_armature(bones):
    """bones: [(名字, head, tail, 父名或 None)]。返回骨架物体。"""
    arm_data = bpy.data.armatures.new('WingRig')
    arm = bpy.data.objects.new('WingRig', arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for name, head, tail, parent in bones:
        eb = arm_data.edit_bones.new(name)
        eb.head, eb.tail = head, tail
        eb.roll = 0
        if parent:
            eb.parent = arm_data.edit_bones[parent]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm


def skin(mesh, arm, weights):
    """weights: {骨名: [每顶点权重]};写顶点组 + 骨架修改器 + 父子关系(保持世界变换不变)。"""
    for name, ws in weights.items():
        vg = mesh.vertex_groups.new(name=name)
        for i, w in enumerate(ws):
            if w > 1e-4:
                vg.add([i], w, 'REPLACE')
    mod = mesh.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    mesh.parent = arm


def rig_membrane(mesh, cfg, m):
    root, elbow, tip = m['root'], m['elbow'], m['tip']
    mir = lambda v: Vector((v.x, -v.y, v.z))
    bones = [('body', Vector((0, 0, 0)), Vector((0, 0, 0.15)), None)]
    for side, f in (('L', lambda v: v), ('R', mir)):
        bones.append((f'wing1_{side}', f(root), f(elbow), 'body'))
        bones.append((f'wing2_{side}', f(elbow), f(tip), f'wing1_{side}'))
    arm = build_armature(bones)
    W = {b[0]: [] for b in bones}
    fz0, fz1 = cfg['feet_z']
    ey = elbow.y
    for v in mesh.data.vertices:
        y, z = abs(v.co.y), v.co.z
        w = smoothstep(cfg['root_y'], cfg['root_y'] + cfg['root_fade'], y)
        if y < 0.22:
            w *= smoothstep(fz0, fz1, z)          # 脚爪归身体
        outer = smoothstep(ey - cfg['elbow_fade'], ey + cfg['elbow_fade'], y)
        side = 'L' if v.co.y > 0 else 'R'
        for name in W:
            W[name].append(0.0)
        W['body'][-1] = 1 - w
        W[f'wing1_{side}'][-1] = w * (1 - outer)
        W[f'wing2_{side}'][-1] = w * outer
    skin(mesh, arm, W)
    return arm


def rig_rigid(mesh, labels, m):
    mir = lambda v: Vector((v.x, -v.y, v.z))
    bones = [('body', Vector((0, 0, 0)), Vector((0, 0, 0.15)), None)]
    for part in ('fore', 'hind'):
        r, t = m[part]['root'], m[part]['tip']
        bones.append((f'{part}_L', r, t, 'body'))
        bones.append((f'{part}_R', mir(r), mir(t), 'body'))
    arm = build_armature(bones)
    W = {b[0]: [0.0] * len(mesh.data.vertices) for b in bones}
    for i, (lab, s) in enumerate(labels):
        W['body' if lab == 'body' else f"{lab}_{'L' if s > 0 else 'R'}"][i] = 1.0
    skin(mesh, arm, W)
    return arm


# ─────────────────────────── 动作 ───────────────────────────
# 每个动作是 pose(t) → {骨名: (骨架空间旋转, 骨架空间平移或 None)};左翼写好,右翼自动镜像。

def wing_pose(lift, sweep_fwd=0.0):
    """左翼(+Y):lift 度 = 绕前进轴上扬(正 = 翼尖往上),sweep_fwd 度 = 翼尖往前(绕 Z 负向)。"""
    return qaxis(UP, -sweep_fwd) @ qaxis(FWD, lift)


def body_pose(dx=0.0, dz=0.0, pitch=0.0, roll=0.0):
    """pitch 正 = 低头(绕 +Y 轴,机头 +X 往下),roll 正 = 向右(-Y)侧倾。"""
    q = qaxis(Vector((0, 1, 0)), pitch) @ qaxis(FWD, -roll)
    return q, Vector((dx, 0, dz))


def membrane_fly(cfg, p):
    a = flap_wave(p, cfg['flap_up'], cfg['flap_down'])
    span = cfg['flap_up'] + cfg['flap_down']
    down01 = (cfg['flap_up'] - a) / span                    # 0 = 最高,1 = 最低
    a2 = flap_wave(p - cfg['outer_lag'], cfg['flap_up'], cfg['flap_down'])
    sweep = cfg['sweep'] * (down01 - 0.5)
    # 前臂(相对上臂):再多扇 outer_gain 倍、相位滞后(鞭梢);上抬过程(p∈[0.4,1))往回收,下扑时展开
    q = (p - 0.4) % 1.0
    up_phase = math.sin(math.pi * q / 0.6) if q < 0.6 else 0.0
    w1 = wing_pose(a, sweep)
    w2 = wing_pose(a2 * cfg['outer_gain'], -cfg['fold'] * up_phase)
    bob = -cfg['bob'] * flap_wave(p - 0.1, 1, 1)            # 下扑后身体被托起
    return {'body': body_pose(dz=bob), 'wing1': (w1, None), 'wing2': (w2, None)}


def rigid_fly(cfg, p):
    a = flap_wave(p, cfg['flap_up'], cfg['flap_down'])
    ah = flap_wave(p - cfg['hind_lag'], cfg['flap_up'], cfg['flap_down']) * cfg['hind_gain']
    span = cfg['flap_up'] + cfg['flap_down']
    sw = lambda x: cfg['sweep'] * ((cfg['flap_up'] - x) / span - 0.5)
    bob = cfg['bob'] * -flap_wave(p - 0.1, 1, 1)
    return {'body': body_pose(dz=bob), 'fore': (wing_pose(a, sw(a)), None), 'hind': (wing_pose(ah, sw(ah / cfg['hind_gain'])), None)}


def blend_pose(pa, pb, t):
    out = {}
    for k in pa:
        qa, ta = pa[k]
        qb, tb = pb[k]
        q = qa.slerp(qb, t)
        tr = None if ta is None and tb is None else (ta or Vector()).lerp(tb or Vector(), t)
        out[k] = (q, tr)
    return out


def make_clips(cfg):
    fly = membrane_fly if cfg['kind'] == 'membrane' else rigid_fly
    T = cfg['period']
    rest = fly(cfg, 0.0)                     # 一次性动作首尾都回到 fly 第 0 帧(翅膀最高点),淡入淡出无跳变
    wings = [k for k in rest if k != 'body']

    # 一次性动作里各翅膀骨跟随主翼的比例:前臂是相对上臂的附加量,后翅略小
    gain = {'wing1': 1.0, 'wing2': cfg.get('outer_gain', 0) * 0.6, 'fore': 1.0, 'hind': cfg.get('hind_gain', 1)}

    def with_wings(lift, sweep, body):
        d = {'body': body}
        for k in wings:
            d[k] = (wing_pose(lift * gain[k], sweep * (0.3 if k == 'wing2' else 1)), None)
        return d

    def attack(t):
        # 0–0.3 蓄力(翅膀高举、身体后仰后撤)→ 0.3–0.55 猛扑(翅膀狠扇到底并前兜、身体前冲低头)→ 0.55–1 回到起始姿势
        up, down = cfg['flap_up'], cfg['flap_down']
        dash, pitch = cfg['attack_dash'], cfg['attack_pitch']
        keys = [
            (0.00, rest),
            (0.30, with_wings(up * 1.5, -cfg['sweep'] * 0.6, body_pose(dx=-dash * 0.25, dz=0.02, pitch=-pitch * 0.4))),
            (0.55, with_wings(-down * 1.25, cfg['sweep'] * 1.2, body_pose(dx=dash, dz=-0.02, pitch=pitch))),
            (1.00, rest),
        ]
        return key_interp(keys, t)

    def hurt(t):
        # 受击:向后一缩 + 左右抖(衰减),翅膀一惊往上收,然后回到起始姿势
        env = math.sin(math.pi * t) * (1 - t)
        shake = math.sin(t * math.pi * 6) * (1 - t) * 14
        flinch = blend_pose(rest, with_wings(cfg['flap_up'] * 1.35, -cfg['sweep'] * 0.5, body_pose()), math.sin(math.pi * t))
        flinch['body'] = body_pose(dx=-0.06 * env * 2, pitch=-10 * env * 2, roll=shake)
        return flinch

    def die(t):
        # 收翅下坠:0–0.35 翅膀猛收(往上并往后贴),之后身体翻滚低头、加速下坠;停在最后一帧(clampWhenFinished)
        fold_t = ease(t / 0.35)
        lift = cfg['flap_up'] + (75 - cfg['flap_up']) * fold_t
        folded = with_wings(lift, -55 * fold_t, None)
        fall = max(0.0, (t - 0.15) / 0.85)
        folded['body'] = body_pose(dz=-cfg['die_drop'] * fall * fall, pitch=70 * ease(fall), roll=40 * ease(fall))
        return blend_pose(rest, folded, ease(t / 0.12)) if t < 0.12 else folded

    return [
        ('fly', T, lambda t: fly(cfg, t), True),
        ('attack', 0.5, attack, False),
        ('hurt', 0.3, hurt, False),
        ('die', 1.0, die, False),
    ]


def key_interp(keys, t):
    for (t0, p0), (t1, p1) in zip(keys, keys[1:]):
        if t <= t1:
            return blend_pose(p0, p1, ease((t - t0) / (t1 - t0)))
    return keys[-1][1]


def bake(arm, name, dur, fn, loop):
    """按 60fps 逐帧 K 四元数 / 位移;循环片段最后一帧 = 第一帧(首尾闭合)。"""
    pb = arm.pose.bones
    rest_q = {b.name: b.bone.matrix_local.to_quaternion() for b in pb}
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    n = max(2, round(dur * FPS))
    prev = {}
    for f in range(n + 1):
        t = f / n
        pose = fn(0.0 if (loop and f == n) else t)
        for b in pb:
            b.rotation_mode = 'QUATERNION'
            key = b.name.rsplit('_', 1)[0] if b.name != 'body' else 'body'
            side = b.name.rsplit('_', 1)[1] if b.name != 'body' else None
            q, tr = pose[key]
            if side == 'R':
                q = mirror_q(q)
            R = rest_q[b.name]
            ql = R.inverted() @ q @ R
            if b.name in prev and prev[b.name].dot(ql) < 0:
                ql = Quaternion((-ql.w, -ql.x, -ql.y, -ql.z))
            prev[b.name] = ql
            b.rotation_quaternion = ql
            b.keyframe_insert('rotation_quaternion', frame=f)
            if b.name == 'body':
                b.location = R.inverted() @ (tr if tr is not None else Vector())
                b.keyframe_insert('location', frame=f)
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, act)
    arm.animation_data.action = None
    return n


# ─────────────────────────── 预览(可选)───────────────────────────

def render_previews(mesh, arm, prefix, clips):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.render.resolution_x, sc.render.resolution_y = 360, 300
    sc.world = bpy.data.worlds.new('w')
    sc.world.color = (0.22, 0.22, 0.27)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 1.35
    cam.location = Vector((2.2, -1.2, 1.0))
    cam.rotation_euler = (-cam.location).to_track_quat('-Z', 'Y').to_euler()
    paths = []
    for tr in arm.animation_data.nla_tracks:   # 预览时静音 NLA:否则所有片段叠在一起播
        tr.mute = True
    for b in arm.pose.bones:                    # 权重图按绑定姿势渲染
        b.rotation_quaternion, b.location = Quaternion(), Vector()
    # 权重:每根骨一个颜色(顶点色)
    cols = {'body': (0.6, 0.6, 0.6), 'wing1_L': (1, .3, .2), 'wing2_L': (1, .8, .1), 'wing1_R': (.2, .5, 1), 'wing2_R': (.2, 1, .8),
            'fore_L': (1, .3, .2), 'hind_L': (1, .8, .1), 'fore_R': (.2, .5, 1), 'hind_R': (.2, 1, .8)}
    me = mesh.data
    attr = me.color_attributes.new('wcol', 'FLOAT_COLOR', 'POINT')
    gname = {g.index: g.name for g in mesh.vertex_groups}
    for v in me.vertices:
        c = Vector((0, 0, 0))
        for g in v.groups:
            c += Vector(cols.get(gname[g.group], (1, 0, 1))) * g.weight
        attr.data[v.index].color = (c.x, c.y, c.z, 1)
    sc.display.shading.color_type = 'VERTEX'
    sc.render.filepath = prefix + '_weights.png'
    bpy.ops.render.render(write_still=True)
    paths.append(sc.render.filepath)
    me.color_attributes.remove(attr)
    sc.display.shading.color_type = 'TEXTURE'
    # 各动作抽帧
    for name, dur, _, _ in clips:
        act = bpy.data.actions[name]
        arm.animation_data.action = act
        n = round(dur * FPS)
        for i in range(6):
            sc.frame_set(round(n * i / 6))
            sc.render.filepath = f'{prefix}_{name}_{i}.png'
            bpy.ops.render.render(write_still=True)
            paths.append(sc.render.filepath)
        arm.animation_data.action = None
    for tr in arm.animation_data.nla_tracks:
        tr.mute = False
    return paths


def quantize_weights(path):
    """导出后处理:WEIGHTS_0 从 float32 改成归一化 uint8(glTF 规范允许,three 直接支持)。
    Blender 导出器只会写 float,7 千顶点 × 16 字节 ≈ 116KB,改完 29KB;每顶点四个权重和仍严格为 255。"""
    import struct
    data = open(path, 'rb').read()
    jlen = struct.unpack_from('<I', data, 12)[0]
    gl = json.loads(data[20:20 + jlen])
    bin_off = 20 + jlen
    blen = struct.unpack_from('<I', data, bin_off)[0]
    buf = bytearray(data[bin_off + 8: bin_off + 8 + blen])
    views = gl['bufferViews']
    chunks = [bytes(buf[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]) for v in views]
    done = 0
    for mesh in gl['meshes']:
        for prim in mesh['primitives']:
            ai = prim['attributes'].get('WEIGHTS_0')
            if ai is None:
                continue
            acc = gl['accessors'][ai]
            if acc['componentType'] != 5126:
                continue
            vi = acc['bufferView']
            src = chunks[vi]
            out = bytearray()
            for k in range(acc['count']):
                w = struct.unpack_from('<4f', src, acc.get('byteOffset', 0) + k * 16)
                q = [round(x * 255) for x in w]
                q[q.index(max(q))] += 255 - sum(q)     # 舍入误差补到最大的那个分量,和保持 255
                out += bytes(q)
            chunks[vi] = bytes(out)
            acc.update(componentType=5121, normalized=True)
            acc.pop('byteOffset', None)
            views[vi].pop('byteStride', None)
            done += 1
    if not done:
        return 0
    newbuf = bytearray()
    for v, c in zip(views, chunks):
        newbuf += b'\0' * (-len(newbuf) % 4)
        v['byteOffset'] = len(newbuf)
        v['byteLength'] = len(c)
        newbuf += c
    newbuf += b'\0' * (-len(newbuf) % 4)
    gl['buffers'][0]['byteLength'] = len(newbuf)
    js = json.dumps(gl, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(newbuf)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(newbuf), 0x004E4942) + newbuf)
    return done


# ─────────────────────────── 主流程 ───────────────────────────

def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    mid, src, dst = argv[:3]
    report_path = argv[3] if len(argv) > 3 else None
    preview = argv[4] if len(argv) > 4 else None
    cfg = MODELS[mid]
    mesh = load(src)
    bpy.context.scene.render.fps = FPS   # 必须在 load 之后:load 里 read_factory_settings 会把帧率重置成 24
    tris0 = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
    rep = {'model': mid, 'src': src, 'dst': dst, 'tris': tris0, 'verts': len(mesh.data.vertices)}
    if cfg['kind'] == 'membrane':
        m = measure_membrane(mesh, cfg)
        rep['measure'] = {k: (list(map(lambda x: round(x, 4), v)) if isinstance(v, Vector) else v) for k, v in m.items()}
        arm = rig_membrane(mesh, cfg, m)
    else:
        labels, stats = classify_rigid(mesh)
        m = measure_rigid(mesh, labels)
        rep['islands'] = stats
        rep['measure'] = {p: {k: (list(map(lambda x: round(x, 4), v)) if isinstance(v, Vector) else v) for k, v in d.items()} for p, d in m.items()}
        arm = rig_rigid(mesh, labels, m)
    clips = make_clips(cfg)
    rep['clips'] = {}
    for name, dur, fn, loop in clips:
        rep['clips'][name] = {'seconds': dur, 'frames': bake(arm, name, dur, fn, loop), 'loop': loop}
    # 权重统计:每根骨的顶点数(权重 > 0.5)
    gname = {g.index: g.name for g in mesh.vertex_groups}
    cnt = {}
    for v in mesh.data.vertices:
        for g in v.groups:
            if g.weight > 0.5:
                cnt[gname[g.group]] = cnt.get(gname[g.group], 0) + 1
    rep['weights'] = cnt
    if preview:
        rep['previews'] = render_previews(mesh, arm, preview, clips)
    # 导出:只选网格 + 骨架;贴图沿用原 JPEG
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=dst, export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_skins=True, export_def_bones=False, export_morph=False,
        export_image_format='AUTO', export_yup=True, export_apply=False,
    )
    rep['quantized_weights'] = quantize_weights(dst)
    rep['bytes_in'], rep['bytes_out'] = os.path.getsize(src), os.path.getsize(dst)
    if report_path:
        with open(report_path, 'w', encoding='utf-8') as f:
            json.dump(rep, f, ensure_ascii=False, indent=1)
    print('WING_ANIM_OK', json.dumps({k: rep[k] for k in ('model', 'tris', 'bytes_in', 'bytes_out')}))


main()
