(() => {
  'use strict';

  const overlay = document.getElementById('mpIntro');
  const canvas = document.getElementById('mpIntroCanvas');
  const skipButton = document.getElementById('mpIntroSkip');
  if (!overlay || !canvas || !skipButton) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ctx = canvas.getContext('2d');
  if (!ctx || reducedMotion.matches) {
    overlay.remove();
    return;
  }

  const phrases = ["NOW & YOUNG!!", "Music Pick Up 80's & 90's"];
  const randomChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#$%&@?';
  const pixelSteps = [1, 2, 3, 4, 6, 8, 11, 15, 20, 27, 36];
  const halfDuration = 2.35;
  const scrambleDuration = 4.7;
  const settleHoldDuration = 0.55;
  const pixelateDuration = 1.7;
  const totalDuration = scrambleDuration + settleHoldDuration + pixelateDuration;
  const swapInterval = scrambleDuration / 76;
  const maxCanvasPixels = 3200000;

  const textScene = document.createElement('canvas');
  const pageScene = document.createElement('canvas');
  const pixelBuffer = document.createElement('canvas');
  const bannerImage = new Image();
  bannerImage.decoding = 'async';
  bannerImage.src = 'images/ogp.jpg';

  let cssWidth = 1;
  let cssHeight = 1;
  let pixelRatio = 1;
  let animationFrame = 0;
  let finished = false;
  let startTime = performance.now();
  let safetyTimer = 0;

  const inertedElements = [];

  function hash(step, index, phase) {
    let value = (step + 1) * 374761393 + (index + 7) * 668265263 + phase * 2246822519;
    value = (value ^ (value >>> 13)) * 1274126177;
    return Math.abs(value ^ (value >>> 16));
  }

  function roundedRect(target, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    target.beginPath();
    target.moveTo(x + r, y);
    target.arcTo(x + width, y, x + width, y + height, r);
    target.arcTo(x + width, y + height, x, y + height, r);
    target.arcTo(x, y + height, x, y, r);
    target.arcTo(x, y, x + width, y, r);
    target.closePath();
  }

  function paintTechBackground(target) {
    const glow = target.createRadialGradient(
      cssWidth / 2, cssHeight / 2, 0,
      cssWidth / 2, cssHeight / 2, Math.max(cssWidth, cssHeight) * 0.6
    );
    glow.addColorStop(0, '#0b222b');
    glow.addColorStop(0.55, '#07171e');
    glow.addColorStop(1, '#050f14');
    target.fillStyle = glow;
    target.fillRect(0, 0, cssWidth, cssHeight);

    const gridSize = cssWidth <= 600 ? 24 : 34;
    target.strokeStyle = 'rgba(33, 217, 227, 0.075)';
    target.lineWidth = 1;
    for (let x = 0; x <= cssWidth; x += gridSize) {
      target.beginPath();
      target.moveTo(x, 0);
      target.lineTo(x, cssHeight);
      target.stroke();
    }
    for (let y = 0; y <= cssHeight; y += gridSize) {
      target.beginPath();
      target.moveTo(0, y);
      target.lineTo(cssWidth, y);
      target.stroke();
    }
  }

  function drawScramble(target, localTime, phase, forceSettled = false) {
    paintTechBackground(target);

    const phrase = phrases[phase];
    const count = phrase.length;
    const sidePadding = Math.max(18, cssWidth * 0.045);
    const usableWidth = cssWidth - sidePadding * 2;
    const cellWidth = Math.min(92, usableWidth / count);
    const fontSize = Math.max(15, Math.min(82, cellWidth * 0.78));
    const baseline = cssHeight * 0.5;
    const barY = baseline + fontSize * 0.66;
    const globalTime = phase * halfDuration + localTime;
    const randomStep = Math.floor((globalTime % scrambleDuration) / swapInterval);

    target.textAlign = 'center';
    target.textBaseline = 'middle';
    target.font = `500 ${fontSize}px "Share Tech Mono", "Courier New", monospace`;

    for (let index = 0; index < count; index += 1) {
      const progress = count === 1 ? 0 : index / (count - 1);
      const settleAt = 0.45 + 0.72 * progress;
      const releaseAt = 1.85 + 0.32 * (1 - progress);
      const holdFinalPhrase = phase === 1;
      const settled = forceSettled || (
        localTime >= settleAt && (holdFinalPhrase || localTime < releaseAt)
      );
      const nextIndex = Math.min(
        count - 1,
        Math.max(0, Math.floor((Math.max(0, localTime - 0.45) / 0.72) * (count - 1)) + 1)
      );
      const glyph = settled
        ? phrase[index]
        : randomChars[hash(randomStep, index, phase) % randomChars.length];
      const sinceSettle = Math.max(0, localTime - settleAt);
      const scale = settled && sinceSettle < 0.45
        ? 1 + 0.2 * Math.exp(-14 * sinceSettle)
        : 1;
      const x = sidePadding + cellWidth * (index + 0.5);

      target.save();
      target.translate(x, baseline);
      target.scale(scale, scale);
      target.globalAlpha = settled ? 1 : 0.75;
      target.fillStyle = settled
        ? (sinceSettle < 0.22 && !forceSettled ? '#ffd166' : '#fff5dc')
        : '#78e4d3';
      target.fillText(glyph, 0, 0);
      target.restore();

      target.globalAlpha = 1;
      target.fillStyle = settled
        ? '#21d9e3'
        : (index === nextIndex && localTime < 1.85 ? '#ffd166' : '#17313a');
      target.fillRect(
        x - cellWidth * 0.36,
        barY,
        cellWidth * 0.72,
        Math.max(3, fontSize * 0.055)
      );
    }
  }

  function drawPageScene() {
    const target = pageScene.getContext('2d');
    const compact = cssWidth <= 600;
    target.clearRect(0, 0, cssWidth, cssHeight);
    target.fillStyle = '#fff8e7';
    target.fillRect(0, 0, cssWidth, cssHeight);

    const horizontalPadding = compact ? 16 : 24;
    const bannerWidth = Math.min(720, cssWidth - horizontalPadding * 2);
    const bannerHeight = bannerWidth * 0.525;
    const bannerX = (cssWidth - bannerWidth) / 2;
    const bannerY = compact ? 18 : 24;

    roundedRect(target, bannerX, bannerY, bannerWidth, bannerHeight, compact ? 7 : 12);
    target.save();
    target.clip();
    if (bannerImage.complete && bannerImage.naturalWidth > 0) {
      target.drawImage(bannerImage, bannerX, bannerY, bannerWidth, bannerHeight);
    } else {
      target.fillStyle = '#170700';
      target.fillRect(bannerX, bannerY, bannerWidth, bannerHeight);
      target.fillStyle = '#0a8f9b';
      target.fillRect(bannerX, bannerY, bannerWidth * 0.52, bannerHeight);
      target.fillStyle = '#e84393';
      target.fillRect(bannerX + bannerWidth * 0.52, bannerY, bannerWidth * 0.48, bannerHeight);
    }
    target.restore();

    let y = bannerY + bannerHeight + (compact ? 16 : 22);
    const contentWidth = Math.min(720, cssWidth - horizontalPadding * 2);
    const contentX = (cssWidth - contentWidth) / 2;

    const newsHeight = compact ? 34 : 40;
    roundedRect(target, contentX, y, contentWidth, newsHeight, newsHeight / 2);
    target.fillStyle = '#006d77';
    target.fill();
    roundedRect(target, contentX, y, Math.min(compact ? 80 : 96, contentWidth * 0.28), newsHeight, newsHeight / 2);
    target.fillStyle = '#e85f99';
    target.fill();
    target.fillStyle = '#ffffff';
    target.textBaseline = 'middle';
    target.font = `700 ${compact ? 10 : 12}px system-ui, sans-serif`;
    target.textAlign = 'center';
    target.fillText('NEWS', contentX + Math.min(compact ? 80 : 96, contentWidth * 0.28) / 2, y + newsHeight / 2);
    target.textAlign = 'left';
    target.font = `600 ${compact ? 9 : 11}px system-ui, sans-serif`;
    target.fillText('放送300回記念  ナウヤン同盟の部屋へようこそ！', contentX + (compact ? 92 : 112), y + newsHeight / 2);

    y += newsHeight + (compact ? 12 : 16);
    const counterWidth = compact ? 168 : 190;
    const counterHeight = compact ? 26 : 28;
    roundedRect(target, (cssWidth - counterWidth) / 2, y, counterWidth, counterHeight, 4);
    target.fillStyle = '#111111';
    target.fill();
    target.strokeStyle = '#006d77';
    target.lineWidth = 1;
    target.stroke();

    y += counterHeight + (compact ? 12 : 18);
    const listenHeight = compact ? 150 : 112;
    roundedRect(target, contentX, y, contentWidth, listenHeight, 14);
    target.fillStyle = '#fff8e7';
    target.fill();
    target.strokeStyle = '#d4af37';
    target.lineWidth = 1;
    target.stroke();

    const buttonWidth = Math.min(compact ? contentWidth * 0.76 : contentWidth * 0.48, 350);
    const buttonHeight = compact ? 42 : 48;
    const buttonX = (cssWidth - buttonWidth) / 2;
    const buttonY = compact ? y + 55 : y + 32;
    roundedRect(target, buttonX, buttonY, buttonWidth, buttonHeight, buttonHeight / 2);
    target.fillStyle = '#00a7e9';
    target.fill();
    target.fillStyle = '#003a52';
    target.textAlign = 'center';
    target.font = `700 ${compact ? 13 : 16}px system-ui, sans-serif`;
    target.fillText('▶  radikoで聴く', cssWidth / 2, buttonY + buttonHeight / 2);

    if (y + listenHeight + 24 < cssHeight) {
      y += listenHeight + 18;
      const cardGap = compact ? 10 : 16;
      const cardColumns = compact ? 1 : 2;
      const cardWidth = (contentWidth - cardGap * (cardColumns - 1)) / cardColumns;
      const cardHeight = compact ? 68 : 82;
      for (let column = 0; column < cardColumns; column += 1) {
        const cardX = contentX + column * (cardWidth + cardGap);
        roundedRect(target, cardX, y, cardWidth, cardHeight, 12);
        target.fillStyle = '#ffffff';
        target.fill();
        target.strokeStyle = '#e8d5b0';
        target.stroke();
        target.fillStyle = '#4dc4ce';
        target.fillRect(cardX, y, cardWidth, 4);
      }
    }
  }

  function fitCanvas() {
    cssWidth = Math.max(1, window.innerWidth);
    cssHeight = Math.max(1, window.innerHeight);
    const maxRatioForArea = Math.sqrt(maxCanvasPixels / (cssWidth * cssHeight));
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2, maxRatioForArea);
    canvas.width = Math.max(1, Math.floor(cssWidth * pixelRatio));
    canvas.height = Math.max(1, Math.floor(cssHeight * pixelRatio));
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    textScene.width = canvas.width;
    textScene.height = canvas.height;
    pageScene.width = canvas.width;
    pageScene.height = canvas.height;
    const textCtx = textScene.getContext('2d');
    const pageCtx = pageScene.getContext('2d');
    textCtx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    pageCtx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    drawScramble(textCtx, 1.35, 1, true);
    drawPageScene();
  }

  function drawPixelated(source, blockSize) {
    const backingScale = Math.max(1, blockSize * pixelRatio);
    const smallWidth = Math.max(1, Math.ceil(canvas.width / backingScale));
    const smallHeight = Math.max(1, Math.ceil(canvas.height / backingScale));
    if (pixelBuffer.width !== smallWidth || pixelBuffer.height !== smallHeight) {
      pixelBuffer.width = smallWidth;
      pixelBuffer.height = smallHeight;
    }
    const pixelCtx = pixelBuffer.getContext('2d');
    pixelCtx.imageSmoothingEnabled = true;
    pixelCtx.clearRect(0, 0, smallWidth, smallHeight);
    pixelCtx.drawImage(source, 0, 0, smallWidth, smallHeight);

    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      pixelBuffer,
      0, 0, smallWidth, smallHeight,
      0, 0, cssWidth, cssHeight
    );
    ctx.imageSmoothingEnabled = true;
  }

  function restorePageInteraction() {
    inertedElements.forEach(element => {
      element.inert = false;
    });
    document.documentElement.classList.remove('mp-intro-active');
  }

  function activateIntro() {
    document.documentElement.classList.add('mp-intro-active');
    document.querySelectorAll('body > *').forEach(element => {
      if (element === overlay || element.tagName === 'SCRIPT' || element.tagName === 'NOSCRIPT') return;
      if ('inert' in element && !element.inert) {
        element.inert = true;
        inertedElements.push(element);
      }
    });
    overlay.classList.add('is-active');
    skipButton.focus({ preventScroll: true });
  }

  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(animationFrame);
    clearTimeout(safetyTimer);
    window.removeEventListener('resize', fitCanvas);
    document.removeEventListener('keydown', handleKeydown);
    restorePageInteraction();
    overlay.remove();
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') finish();
  }

  function animate(now) {
    if (finished) return;
    const elapsed = (now - startTime) / 1000;

    if (elapsed < scrambleDuration) {
      overlay.style.opacity = '1';
      const phase = elapsed < halfDuration ? 0 : 1;
      const localTime = elapsed - phase * halfDuration;
      drawScramble(ctx, localTime, phase);
    } else if (elapsed < scrambleDuration + settleHoldDuration) {
      overlay.style.opacity = '1';
      drawScramble(ctx, 1.35, 1, true);
    } else if (elapsed < totalDuration) {
      const progress = (elapsed - scrambleDuration - settleHoldDuration) / pixelateDuration;
      const towardCoarse = progress <= 0.5 ? progress * 2 : (1 - progress) * 2;
      const stepIndex = Math.min(
        pixelSteps.length - 1,
        Math.round(towardCoarse * (pixelSteps.length - 1))
      );
      const source = progress < 0.5 ? textScene : pageScene;
      drawPixelated(source, pixelSteps[stepIndex]);
      overlay.style.opacity = progress <= 0.5 ? '1' : String(Math.max(0, (1 - progress) * 2));
    } else {
      finish();
      return;
    }

    animationFrame = requestAnimationFrame(animate);
  }

  skipButton.addEventListener('click', finish);
  document.addEventListener('keydown', handleKeydown);
  window.addEventListener('resize', fitCanvas, { passive: true });
  reducedMotion.addEventListener('change', event => {
    if (event.matches) finish();
  }, { once: true });
  bannerImage.addEventListener('load', drawPageScene, { once: true });

  safetyTimer = window.setTimeout(finish, 10000);
  try {
    window.scrollTo(0, 0);
    fitCanvas();
  } catch (error) {
    finish();
    return;
  }
  activateIntro();
  startTime = performance.now();
  animationFrame = requestAnimationFrame(animate);
})();
