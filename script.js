const MESSAGE_SETS = {
  default: [
    ["今晚月色很好"],
    ["西安有月亮"],
    ["长沙也有月亮"],
    ["只是我的身边"],
    ["少了一个你"],
    ["那就先把思念"],
    ["藏进今晚的月光里"],
    ["让它替我去长沙看看你"],
    ["等下一次见面"],
    ["再慢慢告诉你"],
    ["我有多想你"],
    ["中秋快乐 ♡"]
  ],
  family: [
    ["花好月圆"],
    ["阖家团圆"],
    ["身体健康"],
    ["幸福美满"],
    ["金玉满堂"],
    ["心想事成"],
    ["万事如意"],
    ["平安喜乐"],
    ["阖家欢乐"],
    ["中秋快乐"]
  ]
};
const messages = MESSAGE_SETS[document.body.dataset.greetingSet] || MESSAGE_SETS.default;

(() => {
  "use strict";

  const app = document.getElementById("app");
  const scene = document.getElementById("scene");
  const rainCanvas = document.getElementById("rain-canvas");
  const particleCanvas = document.getElementById("particle-canvas");
  const musicButton = document.getElementById("music-toggle");
  const status = document.getElementById("sr-status");
  const rainContext = rainCanvas.getContext("2d", { alpha: true });
  const particleContext = particleCanvas.getContext("2d", { alpha: true });
  const textCanvas = document.createElement("canvas");
  const textContext = textCanvas.getContext("2d", { willReadFrequently: true });

  const CHARS = ["中", "秋", "快", "乐"];
  const RAIN_HEART = "♥";
  const FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';
  const RAIN_TAIL_COLORS = ["rgb(166, 190, 182)", "rgb(186, 139, 158)", "rgb(150, 164, 178)"];
  const RAIN_HEAD_COLORS = ["rgb(195, 213, 204)", "rgb(226, 192, 205)", "rgb(197, 208, 218)"];
  const MUSIC_PATH = "./assets/music.mp3";
  // Enable after placing an MP3 at MUSIC_PATH; the default makes no audio request.
  const MUSIC_ENABLED = false;
  const QUICK_MESSAGES = new Set([1, 2, 3]);
  const LONG_HOLDS = new Set([4, 7, 10, 11]);
  const random = Math.random;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  let width = 0;
  let height = 0;
  let dpr = 1;
  let rainDpr = 1;
  let rainFontSize = 10;
  let cellHeight = 12;
  let rainColumns = [];
  let particles = [];
  let activeCount = 0;
  let messageIndex = -1;
  let phase = "loading";
  let phaseElapsed = 0;
  let phaseDuration = 0;
  let particleNeedsRender = true;
  let lastFrame = 0;
  let rafId = 0;
  let resizeTimer = 0;
  let audio = null;

  if (!rainContext || !particleContext || !textContext) {
    const fallback = document.createElement("p");
    fallback.className = "no-script-message";
    fallback.textContent = "中秋快乐";
    app.append(fallback);
    status.textContent = "中秋快乐";
    return;
  }

  function configureCanvas(canvas, context, scale = dpr) {
    const pixelWidth = Math.max(1, Math.round(width * scale));
    const pixelHeight = Math.max(1, Math.round(height * scale));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    context.setTransform(scale, 0, 0, scale, 0, 0);
  }

  function makeParticle() {
    const tone = random() < 0.075 ? 1 : 0;
    return {
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      driftX: (random() - 0.5) * 0.42,
      driftY: (random() - 0.5) * 0.42,
      seed: random() * Math.PI * 2,
      radius: (width < 500 ? 1.1 : 1.35) * (0.82 + random() * 0.45),
      tone,
      alpha: 0,
      baseAlpha: 0.82 + random() * 0.18
    };
  }

  function ensureParticleCapacity(count) {
    while (particles.length < count) particles.push(makeParticle());
  }

  function getMessageTiming(index) {
    if (LONG_HOLDS.has(index)) return { appear: 980, hold: 2900, dissolve: 900 };
    if (QUICK_MESSAGES.has(index)) return { appear: 740, hold: 1450, dissolve: 620 };
    return { appear: 980, hold: 2050, dissolve: 880 };
  }

  function buildTextTargets(text) {
    const maxWidth = width * 0.85;
    const lines = text.length >= 10
      ? [text.slice(0, Math.ceil(text.length / 2)), text.slice(Math.ceil(text.length / 2))]
      : [text];
    const longestLine = Math.max(1, ...lines.map((line) => line.length));
    let fontSize = Math.min(height * 0.38, maxWidth / longestLine, 88);
    textContext.font = `700 ${fontSize}px ${FONT}`;
    let measuredWidths = lines.map((line) => textContext.measureText(line).width);
    let measuredWidth = Math.max(...measuredWidths);
    while (measuredWidth > maxWidth && fontSize > 10) {
      fontSize -= 1;
      textContext.font = `700 ${fontSize}px ${FONT}`;
      measuredWidths = lines.map((line) => textContext.measureText(line).width);
      measuredWidth = Math.max(...measuredWidths);
    }

    const sampleWidth = Math.max(1, Math.ceil(measuredWidth + fontSize * 0.12));
    const lineHeight = fontSize * 1.28;
    const sampleHeight = Math.max(1, Math.ceil(fontSize * 1.38 + (lines.length - 1) * lineHeight));
    textCanvas.width = sampleWidth;
    textCanvas.height = sampleHeight;
    textContext.font = `700 ${fontSize}px ${FONT}`;
    textContext.textAlign = "center";
    textContext.textBaseline = "middle";
    textContext.fillStyle = "#fff";
    textContext.clearRect(0, 0, sampleWidth, sampleHeight);
    for (let i = 0; i < lines.length; i += 1) {
      const lineOffset = (i - (lines.length - 1) / 2) * lineHeight;
      textContext.fillText(lines[i], sampleWidth / 2, sampleHeight / 2 + lineOffset, maxWidth);
    }

    // Read the text mask once per message, never inside the animation frame.
    const pixels = textContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
    const denseText = text.length >= 10;
    const step = denseText
      ? clamp(fontSize / 16, 1.75, 7)
      : clamp(width / 95, 3.8, 10);
    const maskThreshold = denseText ? 36 : 70;
    const targets = [];
    const left = (width - sampleWidth) / 2;
    const top = (height - sampleHeight) / 2;

    for (let y = 1; y < sampleHeight - 1; y += step) {
      for (let x = 1; x < sampleWidth - 1; x += step) {
        const alphaIndex = (Math.floor(y) * sampleWidth + Math.floor(x)) * 4 + 3;
        if (pixels[alphaIndex] > maskThreshold) targets.push({ x: left + x, y: top + y });
      }
    }
    return targets;
  }

  function setPhase(nextPhase, duration = 0) {
    phase = nextPhase;
    phaseElapsed = 0;
    phaseDuration = duration;
    particleNeedsRender = true;
    app.dataset.phase = nextPhase;
    app.dataset.messageIndex = String(Math.max(0, messageIndex));
  }

  function beginMessage(index, isFirst = false) {
    messageIndex = index;
    const text = messages[index][0];
    const targets = buildTextTargets(text);
    ensureParticleCapacity(targets.length);

    for (let i = 0; i < targets.length; i += 1) {
      const particle = particles[i];
      const target = targets[i];
      particle.targetX = target.x;
      particle.targetY = target.y;
      particle.x = width * (0.13 + random() * 0.74);
      particle.y = height * (0.14 + random() * 0.72);
      particle.driftX = (random() - 0.5) * 0.42;
      particle.driftY = (random() - 0.5) * 0.42;
      particle.alpha = isFirst ? 0.02 : 0;
    }

    activeCount = targets.length;
    status.textContent = text;
    const timing = getMessageTiming(index);
    setPhase("assemble", timing.appear);
  }

  function resampleCurrentMessage() {
    if (messageIndex < 0) return;
    const targets = buildTextTargets(messages[messageIndex][0]);
    ensureParticleCapacity(targets.length);
    const oldCount = activeCount;
    for (let i = 0; i < targets.length; i += 1) {
      const particle = particles[i];
      if (i >= oldCount) {
        particle.x = width * (0.2 + random() * 0.6);
        particle.y = height * (0.2 + random() * 0.6);
        particle.alpha = 0;
      } else {
        particle.x = clamp(particle.x, 0, width);
        particle.y = clamp(particle.y, 0, height);
      }
      particle.targetX = targets[i].x;
      particle.targetY = targets[i].y;
    }
    activeCount = targets.length;
    particleNeedsRender = true;
  }

  function makeRainColumns() {
    rainFontSize = clamp(width / 48, 9, 16);
    cellHeight = rainFontSize * 1.22;
    const columnGap = Math.max(rainFontSize * 1.1, width / 64);
    const count = Math.ceil(width / columnGap) + 1;
    rainColumns = new Array(count);

    for (let i = 0; i < count; i += 1) {
      const maxExtraLength = Math.min(44, Math.max(20, Math.ceil(height / cellHeight * 0.55)));
      const length = 8 + Math.floor(random() * maxExtraLength);
      rainColumns[i] = {
        x: i * columnGap + columnGap * 0.5,
        y: random() * (height + length * cellHeight),
        speed: height * (0.24 + random() * 0.26),
        length,
        opacity: 0.68 + random() * 0.3,
        phase: Math.floor(random() * CHARS.length),
        palette: random() < 0.21 ? 1 : random() < 0.27 ? 2 : 0
      };
    }
    rainContext.font = `${rainFontSize}px ${FONT}`;
    rainContext.textAlign = "center";
    rainContext.textBaseline = "middle";
  }

  function resizeCanvases() {
    const previousWidth = width;
    const previousHeight = height;
    const rect = scene.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    rainDpr = width < 500 && height > width ? Math.min(dpr, 1.75) : dpr;

    if (previousWidth > 0 && previousHeight > 0 && activeCount > 0) {
      const scaleX = width / previousWidth;
      const scaleY = height / previousHeight;
      for (let i = 0; i < activeCount; i += 1) {
        particles[i].x *= scaleX;
        particles[i].y *= scaleY;
      }
    }

    configureCanvas(rainCanvas, rainContext, rainDpr);
    configureCanvas(particleCanvas, particleContext);
    makeRainColumns();

    if (messageIndex < 0) beginMessage(0, true);
    else resampleCurrentMessage();
  }

  function drawRain(delta, now) {
    const context = rainContext;
    context.fillStyle = "rgba(0, 0, 0, 0.16)";
    context.fillRect(0, 0, width, height);
    context.font = `${rainFontSize}px ${FONT}`;
    context.textAlign = "center";
    context.textBaseline = "middle";

    for (let i = 0; i < rainColumns.length; i += 1) {
      const column = rainColumns[i];
      column.y += column.speed * delta / 1000;
      if (column.y - column.length * cellHeight > height) {
        column.y = -random() * height * 0.6 - column.length * cellHeight * 0.25;
      }

      const headY = column.y;
      for (let tail = column.length - 1; tail >= 0; tail -= 1) {
        const y = headY - tail * cellHeight;
        if (y < -cellHeight || y > height + cellHeight) continue;
        const charIndex = (Math.floor(now / 420) + column.phase + tail) % CHARS.length;
        const character = CHARS[charIndex];

        if (tail === 0) {
          context.globalAlpha = Math.min(1, column.opacity + 0.22);
          context.fillStyle = "#edf5f1";
          context.shadowColor = RAIN_HEAD_COLORS[column.palette];
          context.shadowBlur = 5;
        } else {
          context.globalAlpha = column.opacity * Math.pow(0.9, tail);
          context.fillStyle = RAIN_TAIL_COLORS[column.palette];
          context.shadowBlur = 0;
        }
        context.fillText(character, column.x, y);
      }

      const heartY = headY + cellHeight;
      if (heartY >= -cellHeight && heartY <= height + cellHeight) {
        context.font = `${Math.max(8, rainFontSize * 0.86)}px ${FONT}`;
        context.globalAlpha = column.opacity * 0.82;
        context.fillStyle = RAIN_TAIL_COLORS[1];
        context.shadowColor = RAIN_HEAD_COLORS[1];
        context.shadowBlur = 3;
        context.fillText(RAIN_HEART, column.x, heartY);
        context.font = `${rainFontSize}px ${FONT}`;
      }
      context.shadowBlur = 0;
    }
    context.globalAlpha = 1;
  }

  function updateParticles(delta, now) {
    const frameScale = delta / 16.667;
    if (phase === "assemble") {
      const easing = Math.min(0.22, delta / 92);
      const reveal = Math.min(0.24, delta / 86);
      for (let i = 0; i < activeCount; i += 1) {
        const particle = particles[i];
        particle.x += (particle.targetX - particle.x) * easing;
        particle.y += (particle.targetY - particle.y) * easing;
        particle.alpha += (particle.baseAlpha - particle.alpha) * reveal;
      }
    } else if (phase === "hold" || phase === "final") {
      for (let i = 0; i < activeCount; i += 1) {
        const particle = particles[i];
        particle.x = particle.targetX + Math.sin(now * 0.0015 + particle.seed) * 0.24;
        particle.y = particle.targetY + Math.cos(now * 0.0013 + particle.seed) * 0.2;
        particle.alpha = particle.baseAlpha;
      }
    } else if (phase === "dissolve") {
      for (let i = 0; i < activeCount; i += 1) {
        const particle = particles[i];
        particle.x += particle.driftX * frameScale;
        particle.y += particle.driftY * frameScale;
      }
    }
  }

  function drawParticles(now) {
    const context = particleContext;
    context.globalCompositeOperation = "destination-out";
    context.fillStyle = "rgba(0, 0, 0, 0.24)";
    if (phase === "assemble") {
      context.fillRect(0, 0, width, height);
    } else {
      const fadeWidth = Math.min(width, width * 0.85 + 64);
      const fadeHeight = Math.min(height, Math.min(88, height * 0.38) * 1.38 + 64);
      context.fillRect((width - fadeWidth) / 2, (height - fadeHeight) / 2, fadeWidth, fadeHeight);
    }
    context.globalCompositeOperation = "source-over";

    let dissolveAlpha = 1;
    if (phase === "dissolve") dissolveAlpha = 1 - clamp(phaseElapsed / phaseDuration, 0, 1);
    if (phase === "loading") return;

    // A sparse halo keeps the point-text glow soft without blurring its edges.
    context.beginPath();
    for (let i = 0; i < activeCount; i += 7) {
      const particle = particles[i];
      const alpha = particle.alpha * dissolveAlpha;
      if (alpha < 0.03) continue;
      context.globalAlpha = alpha * 0.12;
      context.moveTo(particle.x + particle.radius * 2.3, particle.y);
      context.arc(particle.x, particle.y, particle.radius * 2.3, 0, Math.PI * 2);
    }
    context.fillStyle = "#eaf7f1";
    context.fill();

    for (let tone = 0; tone < 2; tone += 1) {
      context.beginPath();
      for (let i = 0; i < activeCount; i += 1) {
        const particle = particles[i];
        if (particle.tone !== tone) continue;
        const alpha = particle.alpha * dissolveAlpha;
        if (alpha < 0.025) continue;
        context.globalAlpha = alpha;
        context.moveTo(particle.x + particle.radius, particle.y);
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      }
      context.fillStyle = tone === 0 ? "#f7faf8" : "#f1dfe7";
      context.fill();
    }
    context.globalAlpha = 1;
  }

  function advanceTimeline(delta) {
    phaseElapsed += delta;
    if (phaseElapsed < phaseDuration) return;

    if (phase === "assemble") {
      if (messageIndex === messages.length - 1) {
        setPhase("hold", 3000);
      } else {
        setPhase("hold", getMessageTiming(messageIndex).hold);
      }
    } else if (phase === "hold") {
      if (messageIndex === messages.length - 1) {
        setPhase("final");
      } else {
        setPhase("dissolve", getMessageTiming(messageIndex).dissolve);
      }
    } else if (phase === "dissolve") {
      if (messageIndex + 1 < messages.length) beginMessage(messageIndex + 1);
    }
  }

  function frame(now) {
    rafId = 0;
    if (document.hidden) return;
    if (!lastFrame) lastFrame = now;
    const delta = Math.min(48, Math.max(0, now - lastFrame));
    lastFrame = now;
    advanceTimeline(delta);
    const staticParticles = phase === "hold" || phase === "final";
    if (!staticParticles || particleNeedsRender) {
      updateParticles(delta, now);
      drawParticles(now);
      particleNeedsRender = false;
    }
    drawRain(delta, now);
    rafId = window.requestAnimationFrame(frame);
  }

  function startAnimation() {
    if (!rafId && !document.hidden) {
      lastFrame = 0;
      rafId = window.requestAnimationFrame(frame);
    }
  }

  function pauseAnimation() {
    if (rafId) window.cancelAnimationFrame(rafId);
    rafId = 0;
    lastFrame = 0;
  }

  function scheduleResize() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resizeCanvases, 90);
  }

  function prepareOptionalMusic() {
    if (!MUSIC_ENABLED) return;
    audio = new Audio(MUSIC_PATH);
    audio.loop = true;
    audio.preload = "none";
    musicButton.hidden = false;
  }

  async function toggleMusic() {
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      musicButton.setAttribute("aria-pressed", "false");
      musicButton.setAttribute("aria-label", "播放背景音乐");
      return;
    }
    try {
      await audio.play();
      musicButton.setAttribute("aria-pressed", "true");
      musicButton.setAttribute("aria-label", "暂停背景音乐");
    } catch {
      musicButton.setAttribute("aria-pressed", "false");
      musicButton.setAttribute("aria-label", "播放背景音乐");
    }
  }

  window.addEventListener("resize", scheduleResize, { passive: true });
  window.addEventListener("orientationchange", scheduleResize, { passive: true });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", scheduleResize, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseAnimation();
    else startAnimation();
  });
  musicButton.addEventListener("click", toggleMusic);

  resizeCanvases();
  startAnimation();
  prepareOptionalMusic();
})();
