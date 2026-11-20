// XR 控件的矢量图标(暂停 / 继续 / 设置 / 退出 XR):canvas 现画,风格对齐 assets/ui/xr/ 里的位图图标
// (透明底、奶油色填充、金色粗描边 + 内侧细描边)。之后有了美术出图,换成 png 放进 assets.js 的 XR_CONTROLS 即可。

const FILL = '#fbeccb';
const GOLD_LIGHT = '#f2cb52';
const GOLD_DARK = '#b8860b';

function pausePath(s) {
  const p = new Path2D();
  const w = s * 0.17, h = s * 0.56, y = (s - h) / 2, r = s * 0.05;
  p.roundRect(s * 0.27, y, w, h, r);
  p.roundRect(s * 0.56, y, w, h, r);
  return p;
}

function resumePath(s) {
  const p = new Path2D();
  const x0 = s * 0.30, x1 = s * 0.78, y0 = s * 0.22, y1 = s * 0.78, r = s * 0.06;
  // 圆角三角形:每个角用 arcTo 收圆
  p.moveTo(x0, (y0 + y1) / 2);
  p.arcTo(x0, y0, x1, s / 2, r);
  p.arcTo(x1, s / 2, x0, y1, r);
  p.arcTo(x0, y1, x0, y0, r);
  p.closePath();
  return p;
}

function gearPath(s) {
  const p = new Path2D();
  const cx = s / 2, cy = s / 2, teeth = 8;
  const outer = s * 0.34, inner = s * 0.26, hole = s * 0.11;
  for (let i = 0; i < teeth * 4; i++) {
    // 每个齿 4 个点:齿根 → 齿顶 → 齿顶 → 齿根
    const a = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 4 === 1 || i % 4 === 2 ? outer : inner;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
  }
  p.closePath();
  p.moveTo(cx + hole, cy);
  p.arc(cx, cy, hole, 0, Math.PI * 2, true);   // 反向画圆,配合 evenodd 挖出中心孔
  return p;
}

// 头显轮廓 + 两个镜片孔(evenodd 挖空):退出 XR、回到电脑画面
function headsetPath(s) {
  const p = new Path2D();
  const x = s * 0.16, y = s * 0.30, w = s * 0.68, h = s * 0.36, r = s * 0.12;
  p.roundRect(x, y, w, h, r);
  const lw = s * 0.21, lh = s * 0.17, ly = y + (h - lh) / 2 - s * 0.01;
  p.roundRect(s * 0.25, ly, lw, lh, s * 0.07);
  p.roundRect(s * 0.54, ly, lw, lh, s * 0.07);
  return p;
}

const PATHS = { pause: pausePath, resume: resumePath, settings: gearPath, exitxr: headsetPath };

// name:'pause' | 'resume' | 'settings' | 'exitxr' → 正方形 canvas(可直接 drawImage)
export function drawXRIcon(name, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const path = PATHS[name](size);
  ctx.lineJoin = 'round';
  ctx.fillStyle = FILL;
  ctx.fill(path, 'evenodd');
  const gold = ctx.createLinearGradient(0, 0, 0, size);
  gold.addColorStop(0, GOLD_LIGHT);
  gold.addColorStop(1, GOLD_DARK);
  ctx.strokeStyle = gold;
  ctx.lineWidth = size * 0.045;
  ctx.stroke(path);
  ctx.strokeStyle = 'rgba(122, 82, 8, 0.55)';
  ctx.lineWidth = size * 0.012;
  ctx.stroke(path);
  return canvas;
}

export const XR_VECTOR_ICONS = Object.keys(PATHS);
