(() => {
  "use strict";

  const game = document.getElementById("game");
  const stage = document.getElementById("stage");
  const canvas = document.getElementById("playfield");
  const context = canvas.getContext("2d", { alpha: false });
  const hud = document.getElementById("hud");
  const hudTime = document.getElementById("hud-time");
  const hudScore = document.getElementById("hud-score");
  const panelStart = document.getElementById("panel-start");
  const panelOver = document.getElementById("panel-over");
  const bestStart = document.getElementById("best-start");
  const bestOver = document.getElementById("best-over");
  const finalScore = document.getElementById("final-score");
  const buttonStart = document.getElementById("btn-start");
  const buttonAgain = document.getElementById("btn-again");
  const status = document.getElementById("sr-status");

  const BEST_KEY = "mooncake.best.v1";
  const ROUND_MS = 60000;
  const GOLDEN_CHANCE = 0.1;
  const NORMAL_SCORE = 10;
  const GOLDEN_SCORE = 50;

  const MOONCAKE_RADIUS = 17;
  // 下落速度线性提升：从开局 145 px/s 提升到最后一秒的 330 px/s。
  const START_SPEED = 145;
  const END_SPEED = 330;
  // 生成间隔从 720ms 缩短到 430ms（每个月饼再带 ±15% 抖动）。
  const START_INTERVAL_MS = 720;
  const END_INTERVAL_MS = 430;

  const BASKET_HALF = 46;
  const BASKET_HEIGHT = 46;
  const BASKET_BOTTOM_GAP = 36;
  const KEY_SPEED = 720;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const randomBetween = (min, max) => min + Math.random() * (max - min);

  const state = {
    phase: "start",
    score: 0,
    elapsedMs: 0,
    paused: false,
    width: 0,
    height: 0,
    dpr: 1,
    spawnTimer: 0,
    basketX: 0,
    basketY: 0,
    mooncakes: [],
    pops: [],
    stats: { spawned: 0, goldenSpawned: 0, normal: 0, golden: 0, missed: 0 },
    keys: { left: false, right: false },
    pointerId: null
  };

  let best = readBest();
  let frameId = 0;
  let lastFrame = 0;

  function readBest() {
    try {
      const stored = Number(window.localStorage.getItem(BEST_KEY));
      return Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 0;
    } catch {
      return 0;
    }
  }

  function writeBest(value) {
    try {
      window.localStorage.setItem(BEST_KEY, String(value));
    } catch {
      // 隐私模式下写入失败时，最高分只在本次会话内有效。
    }
  }

  function setPhase(phase) {
    state.phase = phase;
    game.dataset.state = phase;
  }

  function updateBestLabels() {
    bestStart.textContent = String(best);
    bestOver.textContent = String(best);
  }

  function updateHud() {
    const remaining = Math.max(0, Math.ceil((ROUND_MS - state.elapsedMs) / 1000));
    hudTime.textContent = String(remaining);
    hudScore.textContent = String(state.score);
  }

  function resize() {
    const rect = stage.getBoundingClientRect();
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.width = Math.max(1, Math.round(rect.width));
    state.height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    state.basketY = state.height - BASKET_BOTTOM_GAP - BASKET_HEIGHT;
    state.basketX = state.basketX ? clampBasket(state.basketX) : state.width / 2;
    draw();
  }

  function clampBasket(x) {
    return clamp(x, BASKET_HALF + 4, state.width - BASKET_HALF - 4);
  }

  function resetRound() {
    state.score = 0;
    state.elapsedMs = 0;
    state.spawnTimer = 260;
    state.mooncakes = [];
    state.pops = [];
    state.stats = { spawned: 0, goldenSpawned: 0, normal: 0, golden: 0, missed: 0 };
    state.basketX = state.width / 2;
    state.paused = false;
    state.keys.left = false;
    state.keys.right = false;
    state.pointerId = null;
    updateHud();
  }

  function startRound() {
    resetRound();
    panelStart.hidden = true;
    panelOver.hidden = true;
    hud.hidden = false;
    setPhase("playing");
    status.textContent = "游戏开始，接住落下的月饼";
    startLoop();
  }

  function endRound() {
    stopLoop();
    setPhase("over");
    if (state.score > best) {
      best = state.score;
      writeBest(best);
    }
    updateBestLabels();
    state.mooncakes = [];
    state.pops = [];
    finalScore.textContent = String(state.score);
    hud.hidden = true;
    panelOver.hidden = false;
    status.textContent = `本局结束，得分 ${state.score} 分，最高分 ${best} 分`;
    draw();
  }

  function progress() {
    return clamp(state.elapsedMs / ROUND_MS, 0, 1);
  }

  function spawnMooncake() {
    const golden = Math.random() < GOLDEN_CHANCE;
    const speed = (START_SPEED + (END_SPEED - START_SPEED) * progress()) * randomBetween(0.9, 1.1);
    const margin = MOONCAKE_RADIUS + 14;
    state.mooncakes.push({
      x: randomBetween(margin, Math.max(margin, state.width - margin)),
      y: -MOONCAKE_RADIUS * 2,
      r: MOONCAKE_RADIUS,
      speed,
      golden,
      spin: randomBetween(-0.5, 0.5),
      angle: randomBetween(0, Math.PI * 2)
    });
    state.stats.spawned += 1;
    if (golden) state.stats.goldenSpawned += 1;
  }

  function addPop(x, y, text, golden) {
    state.pops.push({ x, y, text, golden, life: 760 });
  }

  function update(dt, elapsedDelta) {
    const seconds = dt / 1000;
    state.elapsedMs = Math.min(ROUND_MS, state.elapsedMs + elapsedDelta);

    if (state.keys.left !== state.keys.right) {
      const direction = state.keys.right ? 1 : -1;
      state.basketX = clampBasket(state.basketX + direction * KEY_SPEED * seconds);
    }

    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      spawnMooncake();
      const interval = START_INTERVAL_MS + (END_INTERVAL_MS - START_INTERVAL_MS) * progress();
      state.spawnTimer = interval * randomBetween(0.85, 1.15);
    }

    const rimY = state.basketY;
    const mouthBottom = rimY + BASKET_HEIGHT;

    for (let index = state.mooncakes.length - 1; index >= 0; index -= 1) {
      const cake = state.mooncakes[index];
      cake.y += cake.speed * seconds;
      cake.angle += cake.spin * seconds;

      const insideMouth = cake.y >= rimY - cake.r * 0.35 && cake.y <= mouthBottom;
      const aligned = Math.abs(cake.x - state.basketX) <= BASKET_HALF + cake.r * 0.3;

      if (insideMouth && aligned) {
        state.mooncakes.splice(index, 1);
        state.score += cake.golden ? GOLDEN_SCORE : NORMAL_SCORE;
        state.stats[cake.golden ? "golden" : "normal"] += 1;
        addPop(cake.x, rimY - 10, cake.golden ? `+${GOLDEN_SCORE}` : `+${NORMAL_SCORE}`, cake.golden);
        updateHud();
        continue;
      }

      // 落出画布底部：直接消失，不扣分、不计漏接。
      if (cake.y - cake.r > state.height) {
        state.mooncakes.splice(index, 1);
        state.stats.missed += 1;
      }
    }

    for (let index = state.pops.length - 1; index >= 0; index -= 1) {
      const pop = state.pops[index];
      pop.life -= dt;
      pop.y -= 34 * seconds;
      if (pop.life <= 0) state.pops.splice(index, 1);
    }

    updateHud();
    if (state.elapsedMs >= ROUND_MS) endRound();
  }

  function drawAmbient() {
    if (state.width <= 0) return;
    context.fillStyle = "#000";
    context.fillRect(0, 0, state.width, state.height);
    const glow = context.createRadialGradient(
      state.width / 2, state.height * 0.94, 8,
      state.width / 2, state.height * 0.94, Math.max(state.width, state.height) * 0.85
    );
    glow.addColorStop(0, "rgba(247, 249, 247, 0.055)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, state.width, state.height);
  }

  function drawMooncake(cake) {
    const radius = cake.r;
    context.save();
    context.translate(cake.x, cake.y);

    if (cake.golden) {
      // 金月饼：金色光晕 + 亮金渐变，和普通月饼明显区分。
      const halo = context.createRadialGradient(0, 0, radius * 0.7, 0, 0, radius * 2.1);
      halo.addColorStop(0, "rgba(255, 214, 122, 0.55)");
      halo.addColorStop(1, "rgba(255, 214, 122, 0)");
      context.fillStyle = halo;
      context.beginPath();
      context.arc(0, 0, radius * 2.1, 0, Math.PI * 2);
      context.fill();
    }

    context.shadowColor = cake.golden ? "rgba(255, 224, 138, 0.95)" : "rgba(0, 0, 0, 0.7)";
    context.shadowBlur = cake.golden ? 22 : 6;
    const body = context.createRadialGradient(-radius * 0.32, -radius * 0.38, radius * 0.12, 0, 0, radius);
    if (cake.golden) {
      body.addColorStop(0, "#fffbe4");
      body.addColorStop(0.45, "#f9d261");
      body.addColorStop(1, "#c28a1c");
    } else {
      body.addColorStop(0, "#d9a86c");
      body.addColorStop(0.55, "#a5703a");
      body.addColorStop(1, "#5f3d1d");
    }
    context.fillStyle = body;
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fill();
    context.restore();

    context.save();
    context.translate(cake.x, cake.y);
    context.rotate(cake.angle);
    context.strokeStyle = cake.golden ? "rgba(255, 250, 214, 0.95)" : "rgba(255, 244, 226, 0.4)";
    context.lineWidth = cake.golden ? 1.8 : 1.4;
    context.beginPath();
    context.arc(0, 0, radius * 0.62, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    for (let petal = 0; petal < 4; petal += 1) {
      const angle = (petal * Math.PI) / 2;
      context.moveTo(Math.cos(angle) * radius * 0.2, Math.sin(angle) * radius * 0.2);
      context.lineTo(Math.cos(angle) * radius * 0.56, Math.sin(angle) * radius * 0.56);
    }
    context.stroke();
    if (cake.golden) {
      context.fillStyle = "#fffdf0";
      context.beginPath();
      context.moveTo(0, -radius * 0.34);
      context.lineTo(radius * 0.1, -radius * 0.1);
      context.lineTo(radius * 0.34, 0);
      context.lineTo(radius * 0.1, radius * 0.1);
      context.lineTo(0, radius * 0.34);
      context.lineTo(-radius * 0.1, radius * 0.1);
      context.lineTo(-radius * 0.34, 0);
      context.lineTo(-radius * 0.1, -radius * 0.1);
      context.closePath();
      context.fill();
    }
    context.restore();
  }

  function drawBasket() {
    const x = state.basketX;
    const rimY = state.basketY;
    const half = BASKET_HALF;
    const height = BASKET_HEIGHT;

    context.save();
    context.strokeStyle = "rgba(247, 249, 247, 0.3)";
    context.lineWidth = 2.5;
    context.beginPath();
    context.arc(x, rimY - 3, half * 0.68, Math.PI * 1.1, Math.PI * 1.9);
    context.stroke();

    const body = context.createLinearGradient(x, rimY, x, rimY + height);
    body.addColorStop(0, "rgba(247, 249, 247, 0.18)");
    body.addColorStop(1, "rgba(247, 249, 247, 0.04)");
    context.fillStyle = body;
    context.strokeStyle = "rgba(247, 249, 247, 0.64)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x - half, rimY);
    context.lineTo(x + half, rimY);
    context.lineTo(x + half * 0.72, rimY + height);
    context.lineTo(x - half * 0.72, rimY + height);
    context.closePath();
    context.fill();
    context.stroke();

    context.strokeStyle = "rgba(247, 249, 247, 0.16)";
    context.lineWidth = 1;
    for (let line = 1; line < 4; line += 1) {
      const offset = (height / 4) * line;
      const shrink = half * 0.28 * (offset / height);
      context.beginPath();
      context.moveTo(x - half + shrink, rimY + offset);
      context.lineTo(x + half - shrink, rimY + offset);
      context.stroke();
    }

    context.fillStyle = "rgba(247, 249, 247, 0.88)";
    context.beginPath();
    context.ellipse(x, rimY, half, 4.5, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawPops() {
    context.save();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = '600 17px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
    for (const pop of state.pops) {
      context.globalAlpha = clamp(pop.life / 760, 0, 1);
      context.fillStyle = pop.golden ? "#ffe08a" : "#f7f9f7";
      context.fillText(pop.text, pop.x, pop.y);
    }
    context.restore();
  }

  function draw() {
    drawAmbient();
    for (const cake of state.mooncakes) drawMooncake(cake);
    drawBasket();
    drawPops();
  }

  function frame(timestamp) {
    if (state.phase !== "playing") {
      frameId = 0;
      return;
    }
    if (!lastFrame) lastFrame = timestamp;
    // 倒计时按真实时间推进；下落与移动的步长上限 50ms，避免单帧跳变。
    const elapsedDelta = Math.max(0, timestamp - lastFrame);
    const dt = Math.min(elapsedDelta, 50);
    lastFrame = timestamp;
    update(dt, elapsedDelta);
    draw();
    if (state.phase === "playing") frameId = window.requestAnimationFrame(frame);
  }

  function startLoop() {
    if (frameId || document.hidden) return;
    lastFrame = 0;
    state.paused = false;
    frameId = window.requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (frameId) window.cancelAnimationFrame(frameId);
    frameId = 0;
    lastFrame = 0;
  }

  function moveBasketTo(clientX) {
    const rect = canvas.getBoundingClientRect();
    state.basketX = clampBasket(clientX - rect.left);
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (state.phase !== "playing") return;
    state.pointerId = event.pointerId;
    if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
    moveBasketTo(event.clientX);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (state.pointerId === null || event.pointerId !== state.pointerId) return;
    moveBasketTo(event.clientX);
  });

  function releasePointer(event) {
    if (state.pointerId === null || event.pointerId !== state.pointerId) return;
    state.pointerId = null;
    if (canvas.releasePointerCapture) canvas.releasePointerCapture(event.pointerId);
  }

  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);

  window.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      state.keys.left = true;
      event.preventDefault();
    } else if (event.key === "ArrowRight") {
      state.keys.right = true;
      event.preventDefault();
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.key === "ArrowLeft") state.keys.left = false;
    else if (event.key === "ArrowRight") state.keys.right = false;
  });

  window.addEventListener("blur", () => {
    state.keys.left = false;
    state.keys.right = false;
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopLoop();
      state.paused = state.phase === "playing";
    } else if (state.phase === "playing") {
      startLoop();
    }
  });

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, 90);
  }, { passive: true });
  window.addEventListener("orientationchange", resize, { passive: true });

  buttonStart.addEventListener("click", startRound);
  buttonAgain.addEventListener("click", startRound);

  updateBestLabels();
  resize();
  updateHud();
})();
