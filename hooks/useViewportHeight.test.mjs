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
  }), 812);
});

test("keeps the watermark frozen while the keyboard is up", () => {
  assert.equal(nextFullHeight({
    fullHeight: 812,
    layoutHeight: 383,
    focused: true,
    recentlyFocused: true,
  }), 812);
});

test("keeps the watermark frozen during the dismissal window", () => {
  assert.equal(nextFullHeight({
    fullHeight: 812,
    layoutHeight: 700,
    focused: false,
    recentlyFocused: true,
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
  }), 812);
});

test("heals an inflated mount-time watermark at rest", () => {
  // 812/874 差 ~7%，是噪声：静止时跟随，虚高值必然被纠正。
  assert.equal(nextFullHeight({
    fullHeight: 874,
    layoutHeight: 812,
    focused: false,
    recentlyFocused: false,
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
