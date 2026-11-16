// xr-pointer.js(从 WebXR 空间网页插件移植的指针)冒烟测试:确认移植后行为没走样
import test from 'node:test';
import assert from 'node:assert/strict';
import { Stabilizer, HandArbiter, CursorFx, FREE_AIM_M } from '../js/xr-pointer.js';

const v = (x, y, z) => ({ x, y, z });
const head = { pos: v(0, 0, 0), q: { x: 0, y: 0, z: 0, w: 1 } };

test('CursorFx:没命中时停在上次命中的距离', () => {
  const fx = new CursorFx();
  assert.equal(fx.update(null, 0, 0).dist, FREE_AIM_M);
  let r;
  for (let i = 1; i <= 120; i++) r = fx.update(0.6, i * 16, 0.016);
  assert.ok(Math.abs(r.dist - 0.6) < 0.01 && r.attached);
  for (let i = 121; i <= 200; i++) r = fx.update(null, i * 16, 0.016);
  assert.ok(Math.abs(r.dist - 0.6) < 0.01 && !r.attached);
});

test('Stabilizer:小抖动被压住,大转动跟上', () => {
  const s = new Stabilizer();
  s.update(v(0, 0, 0), v(0, 0, -1), v(0, 0, -1), 1 / 90);
  const small = s.update(v(0, 0, 0), v(0.01, 0, -1), v(0, 0, -1), 1 / 90);
  assert.ok(Math.abs(small.d.x) < 0.005);
  let big;
  for (let i = 0; i < 30; i++) big = s.update(v(0, 0, 0), v(1, 0, -1), v(0, 0, -1), 1 / 90);
  assert.ok(big.d.x > 0.6);
});

test('HandArbiter:只有一只手时就是它;另一只手捏一下抢过来', () => {
  const a = new HandArbiter();
  const hand = (x, pinch = false) => ({ palm: v(x, -0.3, -0.35), pinch, interacting: false });
  assert.equal(a.update({ right: hand(0.15) }, head, 0.016).active, 'right');
  let r;
  for (let i = 0; i < 30; i++) r = a.update({ left: hand(-0.15), right: hand(0.15) }, head, 0.016);
  assert.equal(r.active, 'right');
  r = a.update({ left: hand(-0.15, true), right: hand(0.15) }, head, 0.016);
  assert.equal(r.active, 'left');
  assert.equal(r.stole, true);
});
