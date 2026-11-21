/* 輕量煙測：以 Node 模擬 DOM/Canvas，驗證狀態機可完整跑完一圈。
   執行：node tools/smoke-test.js                                   */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

const handlers = {};
const rafQueue = [];
const gradient = { addColorStop() {} };
const ctx2d = new Proxy({}, {
  get(target, prop) {
    if (prop === 'createLinearGradient') return () => gradient;
    if (prop in target) return target[prop];
    return () => {};
  },
  set(target, prop, value) { target[prop] = value; return true; }
});

function makeElement(id) {
  return {
    id,
    textContent: '',
    disabled: false,
    dataset: {},
    attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    getAttribute(key) { return this.attributes[key]; },
    addEventListener(type, fn) { handlers[`${id}:${type}`] = fn; },
    getContext() { return ctx2d; },
    closest() { return null; }
  };
}

const elements = {};
for (const id of ['slot-canvas', 'credits', 'bet', 'last-result', 'live-region',
                  'spin-button', 'sound-button', 'reset-button']) {
  elements[id] = makeElement(id);
}
const betButtons = [10, 25, 50].map((value) => {
  const el = makeElement('bet-' + value);
  el.dataset.bet = String(value);
  return el;
});

let stored = null;
const sandbox = {
  console,
  performance: { now: () => currentTime },
  Uint32Array,
  Math,
  JSON,
  Number,
  Array,
  String,
  Object,
  Date,
  setTimeout: (fn) => fn(),
  clearTimeout() {},
  requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame() {},
  document: {
    getElementById: (id) => elements[id],
    querySelectorAll: () => betButtons,
    addEventListener(type, fn) { handlers['document:' + type] = fn; },
    hidden: false
  },
  window: {
    crypto: webcrypto,
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }),
    localStorage: {
      getItem: () => stored,
      setItem: (_key, value) => { stored = value; }
    },
    addEventListener() {},
    setTimeout: (fn) => fn(),
    AudioContext: undefined,
    webkitAudioContext: undefined
  }
};
sandbox.window.document = sandbox.document;
sandbox.globalThis = sandbox;

let currentTime = 0;
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'game.js'), 'utf8');
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

function pump(totalMs) {
  const step = 16;
  for (let elapsed = 0; elapsed < totalMs; elapsed += step) {
    currentTime += step;
    const frame = rafQueue.shift();
    if (frame) frame(currentTime);
  }
}

const initialCredits = elements['credits'].textContent;
if (initialCredits !== '1,000') throw new Error('初始餘額不正確：' + initialCredits);

handlers['spin-button:click']();
if (!elements['spin-button'].disabled) throw new Error('旋轉中未鎖定控制項');

pump(4000);

const result = elements['last-result'].textContent;
const finalCredits = elements['credits'].textContent;
if (!['中獎 +' + finalCredits, '未中獎'].includes(result) && !result.startsWith('中獎 +')) {
  throw new Error('結果未結算：' + result);
}
if (elements['spin-button'].disabled) throw new Error('結算後控制項未解鎖');
if (!elements['slot-canvas'].getAttribute('aria-label').includes('轉輪結果')) {
  throw new Error('Canvas aria-label 未更新');
}
if (!elements['live-region'].textContent) throw new Error('ARIA 即時區域未播報');

console.log('煙測通過：初始餘額', initialCredits, '→ 旋轉後餘額', finalCredits, '結果：', result);
console.log('播報內容：', elements['live-region'].textContent);
