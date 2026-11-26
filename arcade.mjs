import {ARENA, CITRUS_ARENAS, CITRUS_PHASES, SIEGE_MISSIONS, SIEGE_SECTORS, citrusCircuit, orbitBreaker} from './arcade-games.mjs';
import {BLADES, BLADE_SPRITE, paintBlade} from './arcade-blades.mjs';

const {width, height, floor} = ARENA;
const palette = {
  peach: ['#ffb67d', '#f56770'], orange: ['#fff0a1', '#e88722'],
  lime: ['#d7fb98', '#4ac06a'], plum: ['#edbaff', '#9a5cd3'],
  melon: ['#ffbaca', '#72cfa1'], drone: ['#ffe0b4', '#f05968'],
  core: ['#c7fff4', '#34d5ba'], gold: ['#fff9cf', '#ffbc22']
};

function circle(ctx, x, y, radius, fill, stroke) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

export function makeArcade({get, makeElement, makeCanvas, Matter}) {
  const canvas = get('#arcade-world');
  const ctx = canvas.getContext('2d');
  const view = get('#arcade-page'), gameArea = get('#arcade-play'), menu = get('#arcade-menu');
  const map = get('#arcade-map'), list = get('#arcade-levels');
  const art = {orbit: get('#arcade-siege-art'), citrus: get('#arcade-market-art')};
  const levels = {orbit: SIEGE_MISSIONS, citrus: CITRUS_ARENAS};
  const games = {orbit: orbitBreaker(Matter), citrus: citrusCircuit()};
  const backgrounds = new Map(), skins = new Map(), best = {orbit: 0, citrus: 0};
  const bladePoses = new Map(), bladeSprites = new Map(), bladeButtons = new Map();
  const picker = get('#arcade-blade-picker');
  const bladeToggles = [get('#arcade-map-blades'), get('#arcade-play-blades')];
  let blade = BLADES[0], pickerOpener = null;
  const trail = [], effects = [];
  const medals = {orbit: [], citrus: []};
  let kind = null, game = null, level = 0, paused = false, active = false, lastHUD = -Infinity;
  let shownPhase = -1, phaseUntil = 0, gameClock = 0;
  for (const image of Object.values(art)) image.addEventListener('load', () => backgrounds.clear());
  try {
    blade = BLADES.find(item => item.id === localStorage.getItem('airlab.arcade.blade')) || blade;
    for (const name of Object.keys(best)) {
      best[name] = Math.max(0, Number(localStorage.getItem('airlab.arcade.' + name)) || 0);
      const stored = JSON.parse(localStorage.getItem('airlab.campaign.' + name) || '[]');
      if (Array.isArray(stored)) medals[name] = stored.slice(0, levels[name].length).map(value =>
        Number.isInteger(value) && value >= 1 && value <= 3 ? value : 0);
    }
  } catch {}

  function setText(id, text) {
    const element = get(id);
    if (element.textContent !== String(text)) element.textContent = text;
  }
  function unlocked(name, index) {
    if (!levels[name]?.[index] || !Number.isInteger(index)) return false;
    for (let i = 0; i < index; i++) if (!medals[name][i]) return false;
    return true;
  }

  function bladeSprite(item) {
    if (!bladeSprites.has(item.id)) {
      const sprite = makeCanvas();
      sprite.width = BLADE_SPRITE.width;
      sprite.height = BLADE_SPRITE.height;
      sprite.setAttribute('aria-hidden', 'true');
      paintBlade(sprite.getContext('2d'), item);
      bladeSprites.set(item.id, sprite);
    }
    return bladeSprites.get(item.id);
  }

  function syncBladePicker() {
    for (const toggle of bladeToggles) {
      toggle.textContent = `Blade · ${blade.name}`;
      toggle.setAttribute('aria-expanded', String(!picker.hidden));
    }
    for (const [id, button] of bladeButtons) button.setAttribute('aria-pressed', String(id === blade.id));
  }

  function closeBladePicker(restoreFocus = false) {
    picker.hidden = true;
    syncBladePicker();
    if (restoreFocus) pickerOpener?.focus();
    pickerOpener = null;
  }

  function toggleBladePicker(opener) {
    if (kind !== 'citrus') return;
    if (!picker.hidden) { closeBladePicker(true); return; }
    cancel();
    if (!bladeButtons.size) {
      const rack = get('#arcade-blade-rack');
      for (const item of BLADES) {
        const button = makeElement('button');
        const label = makeElement('strong'), type = makeElement('small');
        button.type = 'button';
        button.className = 'arcade-blade';
        button.dataset.blade = item.id;
        button.style.setProperty('--blade-tint', item.tint);
        label.textContent = item.name;
        type.textContent = item.type;
        button.append(bladeSprite(item), label, type);
        rack.append(button);
        bladeButtons.set(item.id, button);
      }
    }
    pickerOpener = opener;
    picker.hidden = false;
    syncBladePicker();
    bladeButtons.get(blade.id).focus();
  }

  function equipBlade(id) {
    if (kind !== 'citrus' || picker.hidden) return;
    const choice = BLADES.find(item => item.id === id);
    if (!choice) return;
    blade = choice;
    try { localStorage.setItem('airlab.arcade.blade', blade.id); } catch {}
    closeBladePicker(true);
  }

  function openMap(name = kind) {
    if (!Object.hasOwn(games, name)) return;
    cancel();
    closeBladePicker();
    kind = name;
    game = null;
    bladeToggles[0].hidden = name !== 'citrus';
    view.dataset.game = kind;
    menu.hidden = true; gameArea.hidden = true; map.hidden = false;
    setText('#arcade-map-title', name === 'orbit' ? 'Orbit Breaker' : 'Citrus Circuit');
    setText('#arcade-map-description', name === 'orbit'
      ? 'Clear missions to open the next route. Finish with spare probes to earn more stars.'
      : 'Reach the score goal and survive all three phases to unlock the next arena.');
    list.textContent = '';
    const entries = levels[kind];
    for (const [index, entry] of entries.entries()) {
      const item = makeElement('button');
      item.type = 'button';
      item.className = 'arcade-level';
      item.dataset.level = String(index);
      item.disabled = !unlocked(name, index);
      item.style.setProperty('--sector', name === 'orbit' ? SIEGE_SECTORS[entry.sector].color : entry.hue);
      const label = makeElement('small'), title = makeElement('strong'), caption = makeElement('span');
      label.textContent = name === 'orbit' ? `${SIEGE_SECTORS[entry.sector].name} · ${String(index + 1).padStart(2, '0')}` : `Arena ${index + 1} · Goal ${entry.goal}`;
      title.textContent = entry.name;
      caption.textContent = item.disabled ? 'Locked' : medals[name][index] ? '★'.repeat(medals[name][index]) + '☆'.repeat(3 - medals[name][index]) : 'Play ↗';
      item.append(label, title, caption);
      list.append(item);
    }
    get('#arcade-map-title').focus();
  }

  function launch(index) {
    if (!unlocked(kind, index)) return;
    cancel();
    closeBladePicker();
    level = index;
    game = games[kind];
    game.reset(index);
    paused = false; effects.length = 0;
    gameClock = 0; shownPhase = -1; phaseUntil = 0;
    get('#arcade-phase').hidden = true;
    menu.hidden = true; map.hidden = true; gameArea.hidden = false;
    bladeToggles[1].hidden = kind !== 'citrus';
    setText('#arcade-game-title', levels[kind][index].name);
    setText('#arcade-map-back', kind === 'orbit' ? '← Missions' : '← Arenas');
    setText('#arcade-instructions', kind === 'orbit'
      ? game.pulses ? 'Launch a probe and trigger Nova near the defenses. Gold rings mark shielded cores.' :
        'Pinch the probe, pull back, and release. Break every signal core.'
      : 'Point to aim the blade. Pinch and swipe with its tip, or drag with your mouse. Avoid red drones.');
    get('#arcade-continue').hidden = true;
    refreshHUD();
    if (kind === 'citrus') get('#arcade-continue').focus();
    else canvas.focus();
  }

  function lobby() {
    cancel();
    closeBladePicker();
    game = null; kind = null;
    menu.hidden = false; gameArea.hidden = true; map.hidden = true;
    get('#arcade-orbit-best').textContent = best.orbit;
    get('#arcade-citrus-best').textContent = best.citrus;
  }

  function award(stars) {
    if (stars > (medals[kind][level] || 0)) {
      medals[kind][level] = stars;
      try { localStorage.setItem('airlab.campaign.' + kind, JSON.stringify(medals[kind])); } catch {}
    }
    return '★'.repeat(stars) + '☆'.repeat(3 - stars);
  }

  function refreshHUD() {
    if (!game) return;
    if (game.score > best[kind]) {
      best[kind] = game.score;
      try { localStorage.setItem('airlab.arcade.' + kind, String(game.score)); } catch {}
    }
    setText('#arcade-score', game.score);
    setText('#arcade-best', best[kind]);
    setText('#arcade-meter', kind === 'orbit'
      ? `Mission ${game.stage}/${SIEGE_MISSIONS.length} · ${game.shots} probes · ${game.cores} cores`
      : `${game.seconds}s · ${game.shields} shields · ${game.combo} streak · Goal ${game.goal}`);
    const nova = get('#arcade-pulse');
    nova.hidden = kind !== 'orbit' || !SIEGE_MISSIONS[level]?.pulse;
    nova.disabled = paused || !game.canPulse;
    if (!nova.hidden) setText('#arcade-pulse', `✦ Nova · ${game.pulses}`);
    setText('#arcade-pause', paused ? 'Resume' : 'Pause');
    const result = get('#arcade-round'), next = get('#arcade-continue');
    let title = '', button = '', detail = '';
    if (paused) { title = 'Paused'; button = 'Resume'; }
    else if (kind === 'orbit') {
      if (game.status === 'clear' || game.status === 'won') {
        const stars = award(Math.min(3, game.shots + 1));
        const last = game.status === 'won';
        title = last ? 'Citadel conquered' : 'Mission cleared';
        button = last ? 'Mission map' : 'Next mission';
        detail = `${stars} · ${game.score} points`;
      }
      if (game.status === 'lost') { title = 'Out of probes'; button = 'Retry mission'; detail = 'Use the aim guide to get above the defenses.'; }
    } else {
      if (game.status === 'ready') { title = 'Ready to slice?'; button = 'Start round'; detail = `Reach ${game.goal} points in 35 seconds. Three shields.`; }
      if (game.status === 'finished') {
        if (game.qualified) {
          const ratio = game.score / game.goal;
          const stars = award(ratio >= 1.6 ? 3 : ratio >= 1.25 ? 2 : 1);
          title = level === CITRUS_ARENAS.length - 1 ? 'Circuit champion' : 'Arena cleared';
          button = level === CITRUS_ARENAS.length - 1 ? 'Arena map' : 'Next arena';
          detail = `${stars} · ${game.score} points`;
        } else {
          title = game.shields ? 'Time’s up' : 'Shields down';
          button = 'Retry arena'; detail = `${game.score} of ${game.goal} points`;
        }
      }
    }
    result.hidden = !title;
    next.hidden = !button;
    setText('#arcade-round-title', title);
    setText('#arcade-round-detail', detail);
    setText('#arcade-continue', button);
    setText('#arcade-status', title || (kind === 'orbit'
      ? game.status === 'flight' ? 'Probe launched' : game.name
      : CITRUS_PHASES[game.phase]));
  }

  function togglePause() {
    if (!game || !['ready', 'flight', 'playing'].includes(game.status) || (kind === 'citrus' && game.status === 'ready')) return;
    cancel();
    paused = !paused;
    refreshHUD();
  }
  function advance() {
    if (!game || !picker.hidden) return;
    if (paused) togglePause();
    else if (kind === 'orbit') {
      if (game.status === 'clear') launch(level + 1);
      else if (game.status === 'lost') launch(level);
      else if (game.status === 'won') { openMap(); return; }
    } else {
      if (game.status === 'finished') {
        if (game.qualified && level === CITRUS_ARENAS.length - 1) { openMap(); return; }
        launch(game.qualified ? level + 1 : level);
      } else game.start();
    }
    refreshHUD();
    if (get('#arcade-continue').hidden) canvas.focus();
  }

  function point(x, y, rect = canvas.getBoundingClientRect()) {
    if (!rect.width || !rect.height) return {x: 0, y: 0, inside: false};
    return {x: (x - rect.left) * width / rect.width, y: (y - rect.top) * height / rect.height,
      inside: x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height};
  }
  function citrusPlaying() { return kind === 'citrus' && game?.status === 'playing' && !paused && picker.hidden; }

  function begin(p, id) { if (game && !paused && picker.hidden && p.inside) game.begin(p, id); }
  function move(p, id) {
    if (!game || paused || !picker.hidden) return;
    const segment = game.move(p, id);
    if (kind === 'citrus' && segment) {
      trail.push({...segment, age: 0});
      if (trail.length > 28) trail.shift();
    }
  }
  function release(commit, id) {
    game?.release(commit && !paused && picker.hidden, id);
    if (!commit) bladePoses.delete(id);
  }
  function cancel() { game?.cancel(); trail.length = 0; bladePoses.clear(); }

  function trackBlade(tip, id, base) {
    if (!citrusPlaying()) return false;
    if (tip.inside) {
      const previous = bladePoses.get(id);
      let angle = previous?.angle ?? -.42;
      const origin = base || previous?.tip;
      if (origin) {
        const dx = tip.x - origin.x, dy = tip.y - origin.y;
        if (Math.hypot(dx, dy) >= (base ? 5 : 3)) angle = Math.atan2(dy, dx);
      }
      bladePoses.set(id, {tip, angle});
    } else bladePoses.delete(id);
    move(tip, id);
    return tip.inside;
  }

  function trackFinger(x, y, knuckleX, knuckleY, id) {
    if (!citrusPlaying()) return false;
    const rect = canvas.getBoundingClientRect();
    return trackBlade(point(x, y, rect), id, point(knuckleX, knuckleY, rect));
  }

  canvas.addEventListener('pointerdown', event => {
    canvas.setPointerCapture(event.pointerId);
    const tip = point(event.clientX, event.clientY), id = 'arcade-pointer-' + event.pointerId;
    begin(tip, id);
    if (kind === 'citrus') trackBlade(tip, id);
  });
  function movePointer(event) {
    const tip = point(event.clientX, event.clientY), id = 'arcade-pointer-' + event.pointerId;
    if (kind === 'citrus') trackBlade(tip, id);
    else move(tip, id);
  }
  canvas.addEventListener('pointermove', movePointer);
  canvas.addEventListener('pointerup', event => {
    const id = 'arcade-pointer-' + event.pointerId;
    movePointer(event);
    release(true, id);
    if (event.pointerType !== 'mouse') bladePoses.delete(id);
  });
  for (const input of ['pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(input, event => {
      const id = 'arcade-pointer-' + event.pointerId;
      if (input === 'lostpointercapture' && event.pointerType === 'mouse' && citrusPlaying() && !game.swipes.has(id)) return;
      release(false, id);
    });
  }
  canvas.addEventListener('pointerleave', event => bladePoses.delete('arcade-pointer-' + event.pointerId));

  function backdrop() {
    const zone = kind === 'orbit' ? game.sector : game.arena;
    const key = kind + zone;
    if (backgrounds.has(key)) return backgrounds.get(key);
    const layer = makeCanvas(); layer.width = width; layer.height = height;
    const paint = layer.getContext('2d');
    const gradient = paint.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, kind === 'orbit' ? '#08141e' : '#1b121b');
    gradient.addColorStop(1, kind === 'orbit' ? '#0d3038' : '#39223c');
    paint.fillStyle = gradient;
    paint.fillRect(0, 0, width, height);
    const image = art[kind];
    if (image.naturalWidth) {
      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
      paint.drawImage(image, (width - w) * .5, (height - h) * .4, w, h);
      const color = kind === 'orbit' ? SIEGE_SECTORS[zone].color : CITRUS_ARENAS[zone].hue;
      if (zone) {
        paint.globalCompositeOperation = 'soft-light';
        paint.fillStyle = color;
        paint.fillRect(0, 0, width, height);
        paint.globalCompositeOperation = 'source-over';
      }
      paint.fillStyle = '#070b18' + (kind === 'orbit' ? '48' : '64');
      paint.fillRect(0, 0, width, height);
    }
    paint.lineWidth = 1;
    if (kind === 'orbit') {
      if (!image.naturalWidth) {
        for (let i = 0; i < 65; i++) {
          const x = (i * 193 + 21) % width, y = (i * 131 + 23) % (floor - 50);
          circle(paint, x, y, 1, '#adf3fa48');
        }
      }
      paint.fillStyle = '#0f1522';
      paint.fillRect(0, floor, width, height - floor);
      paint.fillStyle = SIEGE_SECTORS[zone].color;
      paint.fillRect(0, floor, width, 2);
      for (let x = 12; x < width; x += 44) {
        paint.fillStyle = '#3e4e65';
        paint.fillRect(x, floor + 15, 23, 4);
      }
    }
    backgrounds.set(key, layer);
    return layer;
  }

  function skin(name) {
    if (skins.has(name)) return skins.get(name);
    const layer = makeCanvas(); layer.width = layer.height = 96;
    const art = layer.getContext('2d');
    const [highlight, color] = palette[name];
    const gradient = art.createRadialGradient(35, 30, 4, 46, 46, 40);
    gradient.addColorStop(0, highlight);
    gradient.addColorStop(.62, color);
    gradient.addColorStop(1, name === 'core' ? '#167c86' : name === 'gold' ? '#aa5c1c' : '#632944');
    if (name === 'drone') {
      art.fillStyle = '#191927'; art.strokeStyle = '#ff747f'; art.lineWidth = 5;
      art.beginPath(); art.roundRect(15, 15, 66, 66, 18); art.fill(); art.stroke();
      art.fillStyle = '#ffc396'; art.fillRect(30, 43, 36, 8); art.fillRect(44, 29, 8, 36);
    } else {
      art.lineWidth = 2.5;
      circle(art, 48, 48, 35, gradient, highlight);
      if (name === 'core') {
        circle(art, 48, 48, 17, '#163b4b', '#6de8e2');
        circle(art, 48, 48, 8, '#c0fff1');
      } else {
        art.fillStyle = '#9ae6a0';
        art.beginPath(); art.ellipse(56, 15, 12, 4, -.44, 0, Math.PI * 2); art.fill();
        art.fillStyle = '#ffffff56';
        art.beginPath(); art.ellipse(34, 34, 10, 5, -.63, 0, Math.PI * 2); art.fill();
        if (name === 'gold') {
          art.fillStyle = '#fffbdf';
          art.font = 'bold 28px Segoe UI';
          art.textAlign = 'center';
          art.fillText('✦', 48, 61);
        }
      }
    }
    skins.set(name, layer);
    return layer;
  }

  function sprite(name, x, y, radius, angle = 0) {
    const extent = radius * 2.74;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(angle);
    ctx.drawImage(skin(name), -extent / 2, -extent / 2, extent, extent);
    ctx.restore();
  }

  function drawOrbit() {
    for (const body of game.bodies) {
      if (body.plugin.kind === 'core') {
        sprite('core', body.position.x, body.position.y, 15, body.angle);
        if (body.plugin.armor) {
          ctx.lineWidth = 3;
          circle(ctx, body.position.x, body.position.y, 19, null, '#ffcb58');
        }
        continue;
      }
      ctx.save();
      ctx.translate(body.position.x, body.position.y); ctx.rotate(body.angle);
      const isBeam = body.plugin.kind === 'beam';
      const [w, h] = body.plugin.size || (isBeam ? [69, 10] : [13, 40]);
      ctx.fillStyle = body.isStatic ? '#594658' : isBeam ? '#497e8c' : '#314e6a';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#a9e7e7'; ctx.fillRect(-w / 2, -h / 2, w, 2);
      ctx.fillStyle = '#60acbe'; ctx.fillRect(-w / 2, -h / 2, 2, h);
      if (body.isStatic) {
        ctx.fillStyle = '#ff9e68';
        for (let y = -h / 2 + 9; y < h / 2; y += 13) ctx.fillRect(-w / 2 + 3, y, w - 6, 3);
      }
      ctx.restore();
    }
    const anchor = game.launcher;
    ctx.fillStyle = '#2f6374'; ctx.fillRect(anchor.x - 9, anchor.y + 8, 18, floor - anchor.y - 8);
    ctx.lineWidth = 2;
    circle(ctx, anchor.x, anchor.y, 45, '#66dfef15', '#a4f7eb69');
    if (game.activePull) {
      const {x, y} = game.aim();
      ctx.beginPath(); ctx.moveTo(anchor.x - 17, anchor.y);
      ctx.lineTo(game.pull.x, game.pull.y); ctx.lineTo(anchor.x + 17, anchor.y);
      ctx.lineWidth = 4; ctx.strokeStyle = '#d6ffb2'; ctx.stroke();
      for (let i = 3; i < 45; i += 3) {
        const px = game.pull.x + x * i, py = game.pull.y + y * i + game.gravity * (5 / 36) * i * (i + 1);
        if (px > width || px < 0 || py >= floor) break;
        circle(ctx, px, py, Math.max(2, 5 - i / 12), '#f1ffd695');
      }
    }
    if (game.status === 'ready') sprite('core', game.pull.x, game.pull.y, 18);
    if (game.probe) sprite('core', game.probe.position.x, game.probe.position.y, 15);
  }

  function drawCitrus() {
    for (const object of game.objects) {
      if (!object.remove) sprite(object.kind, object.x, object.y, object.radius, object.angle);
    }
    for (const stroke of trail) {
      const alpha = Math.max(0, 1 - stroke.age / 180);
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.lineCap = 'round'; ctx.lineWidth = 2 + alpha * 7;
      ctx.strokeStyle = blade.tint; ctx.beginPath();
      ctx.moveTo(stroke.a.x, stroke.a.y); ctx.lineTo(stroke.b.x, stroke.b.y); ctx.stroke();
      ctx.restore();
    }
  }

  function drawBlades() {
    if (!citrusPlaying() || !bladePoses.size) return;
    const sprite = bladeSprite(blade);
    const {tipX, tipY} = BLADE_SPRITE;
    for (const [id, pose] of bladePoses) {
      ctx.save();
      ctx.translate(pose.tip.x, pose.tip.y);
      ctx.rotate(pose.angle);
      const cutting = game.swipes.has(id);
      ctx.globalAlpha = cutting ? 1 : .76;
      ctx.drawImage(sprite, -tipX, -tipY);
      ctx.lineWidth = 1.5;
      circle(ctx, 0, 0, cutting ? 4.5 : 3.4, blade.steel, blade.tint);
      ctx.restore();
    }
  }

  function drawEffects(ms, animated) {
    const hits = game.sparks.splice(0);
    if (animated) for (const hit of hits) effects.push({...hit, age: 0});
    while (effects.length > 18) effects.shift();
    for (let index = effects.length - 1; index >= 0; index--) {
      const effect = effects[index];
      effect.age += ms;
      if (effect.age > 430 || !animated) { effects.splice(index, 1); continue; }
      const age = effect.age / 430;
      const color = palette[effect.kind || 'core'][0];
      ctx.save(); ctx.globalAlpha = 1 - age; ctx.lineWidth = 1.5;
      if (effect.kind && effect.radius && effect.kind !== 'drone') {
        const radius = effect.radius;
        for (const side of [-1, 1]) {
          ctx.save();
          ctx.translate(effect.x + side * (3 + age * 47), effect.y - age * 29 + age * age * 72);
          ctx.rotate(side * age * .88);
          ctx.beginPath();
          ctx.rect(side < 0 ? -radius * 1.4 : 0, -radius * 1.4, radius * 1.4, radius * 2.8);
          ctx.clip();
          sprite(effect.kind, 0, 0, radius);
          ctx.restore();
        }
      }
      circle(ctx, effect.x, effect.y, 17 + (effect.label === 'NOVA' ? 130 : 63) * age, null, color);
      for (let i = 0; i < 8; i++) {
        const theta = i * Math.PI / 4;
        const spread = 17 + age * (60 + (i % 3) * 15);
        circle(ctx, effect.x + Math.cos(theta) * spread, effect.y + Math.sin(theta) * spread + age * age * 42,
          2 + (1 - age) * 4, color);
      }
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.font = 'bold 17px Segoe UI';
      ctx.fillText(effect.label || '+100', effect.x, effect.y - 28 - age * 30);
      ctx.restore();
    }
  }

  function frame(now, elapsed, tracking, animated) {
    if (now - lastHUD >= 100) {
      lastHUD = now;
      setText('#arcade-tracking', tracking.active ? `${tracking.count} hands tracked` : 'Mouse / touch ready');
      refreshHUD();
    }
    if (!game) return;
    if (!paused && picker.hidden) {
      game.step(elapsed);
      gameClock += elapsed;
      if (kind === 'citrus' && game.status === 'playing' && game.phase !== shownPhase) {
        shownPhase = game.phase;
        const banner = get('#arcade-phase');
        banner.hidden = true;
        setText('#arcade-phase', CITRUS_PHASES[shownPhase]);
        banner.hidden = false;
        phaseUntil = gameClock + 1800;
      }
    }
    get('#arcade-phase').hidden = !citrusPlaying() || gameClock >= phaseUntil;
    for (let i = trail.length - 1; i >= 0; i--) {
      trail[i].age += elapsed;
      if (trail[i].age >= 180 || !animated) trail.splice(i, 1);
    }
    ctx.drawImage(backdrop(), 0, 0);
    if (kind === 'orbit') drawOrbit();
    else drawCitrus();
    drawEffects(elapsed, animated);
    if (kind === 'citrus') drawBlades();
  }

  return {
    openGame: openMap, openMap, launch, lobby, advance, togglePause, point, begin, move, release, cancel, frame,
    toggleBladePicker, equipBlade, trackFinger,
    dismissBladePicker() { if (picker.hidden) return false; closeBladePicker(true); return true; },
    restart() { if (active && game) launch(level); },
    pulse() { if (!paused && kind === 'orbit' && game?.pulse()) refreshHUD(); },
    show(visible) {
      active = visible;
      view.hidden = !visible;
      if (!visible) { cancel(); closeBladePicker(); }
      else {
        for (const image of Object.values(art)) if (image.dataset.src && !image.src) image.src = image.dataset.src;
        if (!kind) lobby();
      }
    },
    suspend() {
      cancel();
      if (active && !paused && game && ['flight', 'playing'].includes(game.status)) togglePause();
    },
    get active() { return active; }, get playing() { return Boolean(game); },
    get tracksFinger() { return active && kind === 'citrus' && Boolean(game); },
    get browsingLevels() { return kind !== null && !game; },
    get mode() { return kind === 'orbit' ? 'orbit breaker' : kind === 'citrus' ? 'citrus circuit' : 'arcade'; }
  };
}
