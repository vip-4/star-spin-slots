/* ============================================================
   星耀拉霸 Star Spin — 遊戲主程式
   - 純前端、無相依套件
   - 狀態機：IDLE → SPINNING（含 STOPPING）→ EVALUATING → IDLE
   - 所有點數皆為「虛擬幣」，不具現金價值
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- 常數與設定 ---------------- */
  const LOGICAL_WIDTH = 720;   // Canvas 邏輯寬度
  const LOGICAL_HEIGHT = 360;  // Canvas 邏輯高度
  const REEL_COUNT = 3;
  const CELL_HEIGHT = 80;      // 單一符號格高度
  const STRIP_LENGTH = 40;     // 每軸隨機符號帶長度
  const START_CREDITS = 1000;
  const STORAGE_KEY = 'starspin.state.v1';

  // 符號表：weight 為加權抽樣權重，payout 為中獎倍數
  const SYMBOLS = [
    { id: 'cherry',  name: '櫻桃',   glyph: '🍒', color: '#c0392b', bg: '#fff0ed', weight: 30, payout: 10 },
    { id: 'lemon',   name: '檸檬',   glyph: '🍋', color: '#9a7d0a', bg: '#fff9dd', weight: 24, payout: 15 },
    { id: 'bell',    name: '鐘聲',   glyph: '🔔', color: '#8a5a00', bg: '#fff5df', weight: 18, payout: 25 },
    { id: 'diamond', name: '鑽石',   glyph: '◆',   color: '#1f6f9c', bg: '#e8f4fb', weight: 16, payout: 40 },
    { id: 'seven',   name: '幸運 7', glyph: '7',   color: '#b8860b', bg: '#fbf1d2', weight: 12, payout: 80 }
  ];

  const STATE = Object.freeze({
    IDLE: 'IDLE',
    SPINNING: 'SPINNING',
    EVALUATING: 'EVALUATING'
  });

  const TOTAL_WEIGHT = SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
  const prefersReducedMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- DOM 取得 ---------------- */
  const canvas = document.getElementById('slot-canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const creditsEl = document.getElementById('credits');
  const betEl = document.getElementById('bet');
  const resultEl = document.getElementById('last-result');
  const liveRegion = document.getElementById('live-region');
  const spinButton = document.getElementById('spin-button');
  const soundButton = document.getElementById('sound-button');
  const resetButton = document.getElementById('reset-button');
  const betButtons = Array.from(document.querySelectorAll('.bet-button'));

  if (!ctx) {
    liveRegion.textContent = '此瀏覽器不支援 Canvas 2D，無法顯示遊戲。';
    return;
  }

  /* ---------------- 遊戲狀態 ---------------- */
  let credits = START_CREDITS;
  let bet = 10;
  let state = STATE.IDLE;
  let muted = true;                 // 預設靜音，符合行動瀏覽器自動播放限制
  let audioContext = null;
  let rafId = null;
  let lastFrameTime = 0;
  let spinElapsed = 0;
  let currentResult = null;
  let winAmount = 0;

  // 粒子物件池：避免頻繁配置物件造成 GC 卡頓
  const particles = Array.from({ length: 48 }, () => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, color: '#f5c451', size: 4
  }));

  // 三個轉輪的執行期資料
  const reels = Array.from({ length: REEL_COUNT }, () => ({
    strip: [],
    offset: 0,          // 目前捲動位移（px）
    phase: 'idle',      // idle | scroll | stopping
    startTime: 0,
    duration: 0,
    fromOffset: 0,
    toOffset: 0,
    targetSymbol: null
  }));

  /* ---------------- 工具函式 ---------------- */
  const formatNumber = (value) => Math.round(value).toLocaleString('zh-Hant-TW');
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  /**
   * 加權隨機抽樣。
   * 正式營運版本必須改由伺服器回傳結果，前端僅呈現動畫。
   */
  function randomSymbol() {
    const buffer = new Uint32Array(1);
    let roll;
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(buffer);
      roll = buffer[0] % TOTAL_WEIGHT;
    } else {
      // 降級路徑：僅供不支援 crypto 的舊瀏覽器
      roll = Math.floor(Math.random() * TOTAL_WEIGHT);
    }
    let acc = 0;
    for (const symbol of SYMBOLS) {
      acc += symbol.weight;
      if (roll < acc) return symbol;
    }
    return SYMBOLS[SYMBOLS.length - 1];
  }

  function buildStrip() {
    return Array.from({ length: STRIP_LENGTH }, () => randomSymbol());
  }

  function announce(message) {
    liveRegion.textContent = message;
  }

  function updateHud() {
    creditsEl.textContent = formatNumber(credits);
    betEl.textContent = formatNumber(bet);
  }

  function persist() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ credits, bet }));
    } catch (err) {
      // 隱私模式或儲存空間受限時直接忽略，不影響遊戲
    }
  }

  function restore() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (Number.isFinite(saved.credits) && saved.credits >= 0) {
        credits = Math.floor(saved.credits);
      }
      if ([10, 25, 50].includes(saved.bet)) {
        bet = saved.bet;
      }
    } catch (err) {
      // 資料損毀時使用預設值
    }
  }

  /* ---------------- 音效（Web Audio API） ---------------- */
  function ensureAudio() {
    if (!muted && !audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) audioContext = new AudioCtx();
    }
    // iOS Safari：必須在使用者手勢中 resume
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
  }

  function playTone(frequency, duration, type, volume) {
    if (muted || !audioContext) return;
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume || 0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  /* ---------------- Canvas 尺寸與繪製 ---------------- */
  function resizeCanvas() {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2); // 限制 DPR，避免高解析手機過度繪製
    canvas.width = Math.round(LOGICAL_WIDTH * dpr);
    canvas.height = Math.round(LOGICAL_HEIGHT * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFrame();
  }

  function roundRect(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }

  function reelRect(index) {
    const gap = 20;
    const width = 180;
    const total = REEL_COUNT * width + (REEL_COUNT - 1) * gap;
    const startX = (LOGICAL_WIDTH - total) / 2;
    return { x: startX + index * (width + gap), y: 48, width, height: 264 };
  }

  function drawSymbol(symbol, centerX, centerY, scale) {
    const size = 64 * scale;
    ctx.save();
    ctx.fillStyle = symbol.bg;
    ctx.strokeStyle = symbol.color;
    ctx.lineWidth = 2;
    roundRect(centerX - size / 2, centerY - size / 2, size, size, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = symbol.color;
    ctx.font = '700 ' + Math.round(36 * scale) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(symbol.glyph, centerX, centerY + 2);
    ctx.restore();
  }

  function drawReel(index) {
    const reel = reels[index];
    const rect = reelRect(index);
    const centerY = rect.y + rect.height / 2;

    ctx.save();
    roundRect(rect.x, rect.y, rect.width, rect.height, 14);
    ctx.clip();

    // 依目前 offset 決定要畫哪些符號格
    const baseIndex = Math.floor(reel.offset / CELL_HEIGHT);
    const fraction = reel.offset - baseIndex * CELL_HEIGHT;
    for (let k = -2; k <= 2; k += 1) {
      const idx = ((baseIndex + k) % reel.strip.length + reel.strip.length) % reel.strip.length;
      const symbol = reel.strip[idx];
      const y = centerY + k * CELL_HEIGHT - fraction;
      if (y < rect.y - CELL_HEIGHT || y > rect.y + rect.height + CELL_HEIGHT) continue;
      drawSymbol(symbol, rect.x + rect.width / 2, y, 1);
    }

    // 上下漸層遮罩，讓捲動看起來更自然
    const topFade = ctx.createLinearGradient(0, rect.y, 0, rect.y + 56);
    topFade.addColorStop(0, 'rgba(16,26,48,0.92)');
    topFade.addColorStop(1, 'rgba(16,26,48,0)');
    ctx.fillStyle = topFade;
    ctx.fillRect(rect.x, rect.y, rect.width, 56);

    const bottomFade = ctx.createLinearGradient(0, rect.y + rect.height, 0, rect.y + rect.height - 56);
    bottomFade.addColorStop(0, 'rgba(16,26,48,0.92)');
    bottomFade.addColorStop(1, 'rgba(16,26,48,0)');
    ctx.fillStyle = bottomFade;
    ctx.fillRect(rect.x, rect.y + rect.height - 56, rect.width, 56);
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2;
    roundRect(rect.x, rect.y, rect.width, rect.height, 14);
    ctx.stroke();
  }

  function drawPayline() {
    const first = reelRect(0);
    const last = reelRect(REEL_COUNT - 1);
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = 'rgba(245,196,81,0.75)';
    ctx.lineWidth = 2;
    const y = first.y + first.height / 2;
    ctx.beginPath();
    ctx.moveTo(first.x - 12, y);
    ctx.lineTo(last.x + last.width + 12, y);
    ctx.stroke();
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      if (!p.active) continue;
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawFrame() {
    // 背景
    const bg = ctx.createLinearGradient(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    bg.addColorStop(0, '#223559');
    bg.addColorStop(1, '#101a30');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    // 標題
    ctx.fillStyle = '#f5c451';
    ctx.font = '700 17px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('STAR SPIN  ·  3 REELS', LOGICAL_WIDTH / 2, 30);

    for (let i = 0; i < REEL_COUNT; i += 1) drawReel(i);
    drawPayline();
    drawParticles();

    // 狀態文字
    ctx.fillStyle = 'rgba(232,236,245,0.82)';
    ctx.font = '500 13px system-ui, sans-serif';
    const caption = state === STATE.SPINNING ? '轉輪旋轉中…'
      : winAmount > 0 ? '中獎！ +' + formatNumber(winAmount) + ' 虛擬幣'
      : '中間支付線 · 三個相同符號即中獎';
    ctx.fillText(caption, LOGICAL_WIDTH / 2, LOGICAL_HEIGHT - 16);
  }

  /* ---------------- 粒子更新 ---------------- */
  function spawnParticles() {
    if (prefersReducedMotion) return;
    let count = 0;
    for (const p of particles) {
      if (p.active || count >= 36) continue;
      p.active = true;
      p.x = LOGICAL_WIDTH / 2 + (Math.random() - 0.5) * 240;
      p.y = LOGICAL_HEIGHT / 2 + (Math.random() - 0.5) * 40;
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.12 + Math.random() * 0.28;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed - 0.12;
      p.maxLife = 700 + Math.random() * 500;
      p.life = p.maxLife;
      p.size = 3 + Math.random() * 4;
      p.color = Math.random() > 0.4 ? '#f5c451' : '#ffffff';
      count += 1;
    }
  }

  function updateParticles(dt) {
    for (const p of particles) {
      if (!p.active) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 0.0006 * dt; // 重力
      p.life -= dt;
      if (p.life <= 0) p.active = false;
    }
  }

  /* ---------------- 狀態機 ---------------- */
  function setControlsEnabled(enabled) {
    spinButton.disabled = !enabled;
    betButtons.forEach((btn) => { btn.disabled = !enabled; });
  }

  function startSpin() {
    if (state !== STATE.IDLE) return;
    if (credits < bet) {
      announce('虛擬幣不足，請重置虛擬幣或降低注額。');
      resultEl.textContent = '餘額不足';
      return;
    }

    ensureAudio();
    state = STATE.SPINNING;
    spinElapsed = 0;
    winAmount = 0;
    credits -= bet;
    // 注意：必須按轉輪數量抽樣；若誤用 SYMBOLS.map 會抽出 5 個結果
    currentResult = reels.map(() => randomSymbol());
    updateHud();
    setControlsEnabled(false);
    resultEl.textContent = '旋轉中…';
    announce('轉輪開始旋轉。');
    playTone(420, 0.09, 'square', 0.05);

    const stopTimes = prefersReducedMotion ? [60, 90, 120] : [520, 760, 1000];
    const durations = prefersReducedMotion ? [80, 80, 80] : [520, 620, 720];
    const scrollSpeed = prefersReducedMotion ? 0.2 : 0.95;

    reels.forEach((reel, index) => {
      reel.strip = buildStrip();
      reel.offset = index * 37; // 讓三軸初始位置不一致
      reel.phase = 'scroll';
      reel.targetSymbol = currentResult[index];
      reel.stopTime = stopTimes[index];
      reel.duration = durations[index];
      reel.scrollSpeed = scrollSpeed;
    });

    if (rafId === null) {
      lastFrameTime = performance.now();
      rafId = requestAnimationFrame(tick);
    }
  }

  function beginStop(reel, now) {
    reel.phase = 'stopping';
    reel.startTime = now;
    reel.fromOffset = reel.offset;

    // 從目前位置往前尋找第一個符合目標符號的格位
    const cell = Math.ceil(reel.offset / CELL_HEIGHT);
    let found = cell;
    for (let i = 0; i < reel.strip.length + 1; i += 1) {
      const idx = ((cell + i) % reel.strip.length + reel.strip.length) % reel.strip.length;
      if (reel.strip[idx].id === reel.targetSymbol.id) {
        found = cell + i;
        break;
      }
    }
    reel.toOffset = found * CELL_HEIGHT;
    playTone(300 + reel.targetSymbol.payout * 3, 0.06, 'triangle', 0.04);
  }

  function evaluate() {
    state = STATE.EVALUATING;
    const [a, b, c] = currentResult;
    const isWin = a.id === b.id && b.id === c.id;
    winAmount = isWin ? b.payout * bet : 0;
    credits += winAmount;
    updateHud();
    persist();

    const names = currentResult.map((s) => s.name).join('、');
    canvas.setAttribute('aria-label', '轉輪結果：' + names + (isWin ? '，中獎 ' + formatNumber(winAmount) + ' 虛擬幣' : '，未中獎'));

    if (isWin) {
      resultEl.textContent = '中獎 +' + formatNumber(winAmount);
      announce('中獎！' + b.name + '三個相同，獲得 ' + formatNumber(winAmount) + ' 虛擬幣。');
      spawnParticles();
      playTone(523, 0.12, 'sine', 0.09);
      window.setTimeout(() => playTone(659, 0.12, 'sine', 0.09), 110);
      window.setTimeout(() => playTone(784, 0.2, 'sine', 0.09), 220);
    } else {
      resultEl.textContent = '未中獎';
      announce('本次未中獎，結果為 ' + names + '。');
    }

    state = STATE.IDLE;
    setControlsEnabled(true);
  }

  function tick(now) {
    const dt = Math.min(now - lastFrameTime, 50); // 限制單幀最大間隔，避免切回分頁時跳轉
    lastFrameTime = now;
    spinElapsed += dt;
    let allIdle = true;

    for (const reel of reels) {
      if (reel.phase === 'scroll') {
        reel.offset += reel.scrollSpeed * dt;
        if (spinElapsed >= reel.stopTime) beginStop(reel, now);
      }
      if (reel.phase === 'stopping') {
        const t = clamp((now - reel.startTime) / reel.duration, 0, 1);
        reel.offset = reel.fromOffset + (reel.toOffset - reel.fromOffset) * easeOutCubic(t);
        if (t >= 1) {
          reel.offset = reel.toOffset % (reel.strip.length * CELL_HEIGHT);
          reel.phase = 'idle';
        }
      }
      if (reel.phase !== 'idle') allIdle = false;
    }

    updateParticles(dt);
    drawFrame();

    if (state === STATE.SPINNING && allIdle) {
      evaluate();
    }

    const hasParticles = particles.some((p) => p.active);
    if (state === STATE.SPINNING || hasParticles) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = null;
    }
  }

  /* ---------------- 事件綁定 ---------------- */
  spinButton.addEventListener('click', startSpin);

  betButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (state !== STATE.IDLE) return;
      bet = Number(button.dataset.bet) || 10;
      betButtons.forEach((btn) => {
        btn.setAttribute('aria-pressed', String(btn === button));
      });
      updateHud();
      persist();
      announce('注額已設為 ' + formatNumber(bet) + ' 虛擬幣。');
    });
  });

  soundButton.addEventListener('click', () => {
    muted = !muted;
    soundButton.setAttribute('aria-pressed', String(!muted));
    soundButton.setAttribute('aria-label', muted ? '開啟音效' : '關閉音效');
    soundButton.textContent = (muted ? '🔇' : '🔊') + ' 音效';
    ensureAudio();
    playTone(660, 0.08, 'sine', 0.06);
  });

  resetButton.addEventListener('click', () => {
    if (state !== STATE.IDLE) return;
    credits = START_CREDITS;
    winAmount = 0;
    currentResult = null;
    resultEl.textContent = '準備好了';
    canvas.setAttribute('aria-label', '老虎機轉輪，目前尚未旋轉');
    updateHud();
    persist();
    announce('虛擬幣已重置為 ' + formatNumber(START_CREDITS) + '。');
    drawFrame();
  });

  // 空白鍵快速旋轉；若焦點在按鈕上，交給瀏覽器原生 click 處理，避免觸發兩次
  document.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || event.repeat) return;
    const target = event.target;
    if (target && target.closest && target.closest('button, a, input, textarea, select, summary')) return;
    event.preventDefault();
    startSpin();
  });

  window.addEventListener('resize', resizeCanvas, { passive: true });

  // 分頁切換時暫停 AudioContext，避免背景耗電
  document.addEventListener('visibilitychange', () => {
    if (!audioContext) return;
    if (document.hidden) {
      audioContext.suspend().catch(() => {});
    } else if (!muted) {
      audioContext.resume().catch(() => {});
    }
  });

  /* ---------------- 初始化 ---------------- */
  restore();
  betButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(Number(button.dataset.bet) === bet));
  });
  updateHud();
  reels.forEach((reel, index) => {
    reel.strip = buildStrip();
    reel.offset = index * 37 + (8 + index * 3) * CELL_HEIGHT;
  });
  resizeCanvas();
  drawFrame();
})();
