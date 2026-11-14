import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { nextFullHeight, isKeyboardPeriod } = await jiti.import("./useViewportHeight.ts");

test("learns the layout from an unknown watermark", () => {
  assert.equal(nextFullHeight({
    fullHeight: 0,
    layoutHeight: 812,
    focused: true,
    recentlyFocused: true,
    layoutStableMs: 600,
  }), 812);
});

test("keeps the watermark frozen while the keyboard is up", () => {
  assert.equal(nextFullHeight({
    fullHeight: 812,
    layoutHeight: 383,
    focused: true,
    recentlyFocused: true,
    layoutStableMs: 600,
  }), 812);
});

test("keeps the watermark frozen during the dismissal window", () => {
  assert.equal(nextFullHeight({
    fullHeight: 812,
    layoutHeight: 700,
    focused: false,
    recentlyFocused: true,
    layoutStableMs: 600,
  }), 812);
});

test("never learns a keyboard-shrunk layout as the watermark", () => {
  // 焦点被 IME/附件栏瞬时吃掉 1s 后（recentlyFocused 已过期），键盘仍缩着布局：
  // 学进去就塌陷（钉高 383、滚动量归零、顶栏推不出去且闪）。
  assert.equal(nextFullHeight({
    fullHeight: 812,
    layoutHeight: 383,
    focused: false,
    recentlyFocused: false,
    layoutStableMs: 600,
  }), 812);
});

test("heals an inflated mount-time watermark at rest", () => {
  // 812/874 差 ~7%，是噪声：静止时跟随，虚高值必然被纠正。
  assert.equal(nextFullHeight({
    fullHeight: 874,
    layoutHeight: 812,
    focused: false,
    recentlyFocused: false,
    layoutStableMs: 600,
  }), 812);
});

test("marks the keyboard period while focused", () => {
  assert.equal(isKeyboardPeriod({
    layoutHeight: 812,
    fullHeight: 812,
    focused: true,
  }), true);
});

test("stays in the keyboard period until the layout regrows", () => {
  assert.equal(isKeyboardPeriod({
    layoutHeight: 700,
    fullHeight: 812,
    focused: false,
  }), true);
  assert.equal(isKeyboardPeriod({
    layoutHeight: 812,
    fullHeight: 812,
    focused: false,
  }), false);
});

test("never learns a mid-animation reading, however long the drag lasts", () => {
  // 交互拖拽收键盘可以超过 recentlyFocused 的 1s 冻结（focused 早已 false）。
  // 拖拽期间读数逐帧在变（stableMs 很小），任何中间值都不许学——
  // 学进去就是「下落时尺寸变化」：钉高塌陷 + 落底后再修一次。
  assert.equal(nextFullHeight({
    fullHeight: 812,
    layoutHeight: 700,
    focused: false,
    recentlyFocused: false,
    layoutStableMs: 50,
  }), 812);
});

test("learns a layout change only once the reading has settled", () => {
  // 读数静止满 500ms 才可能是真实变化（状态栏挤占一步到位、转屏回稳）。
  assert.equal(nextFullHeight({
    fullHeight: 812,
    layoutHeight: 790,
    focused: false,
    recentlyFocused: false,
    layoutStableMs: 499,
  }), 812);
  assert.equal(nextFullHeight({
    fullHeight: 812,
    layoutHeight: 790,
    focused: false,
    recentlyFocused: false,
    layoutStableMs: 500,
  }), 790);
});

test("stability never bypasses the keyboard-shrink and inflation guards", () => {
  // 静止读数仍受既有守卫约束：键盘缩小的布局和上行虚高都不许学。
  assert.equal(nextFullHeight({
    fullHeight: 812,
    layoutHeight: 383,
    focused: false,
    recentlyFocused: false,
    layoutStableMs: 600,
  }), 812);
  assert.equal(nextFullHeight({
    fullHeight: 812,
    layoutHeight: 900,
    focused: false,
    recentlyFocused: false,
    layoutStableMs: 600,
  }), 812);
});
