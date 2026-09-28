// Developer tool: lets you pose a character's rig, string 3-6 key poses
// into a named motion, preview it, and export the data js/motions.js
// expects. Reads/writes window.CHARACTER_RIGS directly (in-memory only --
// use the export/copy button to persist a motion back into motions.js).
(() => {
  'use strict';

  const rigs = window.CHARACTER_RIGS;
  const engine = window.RigEngine;

  const els = {
    toggle: document.getElementById('rig-editor-toggle'),
    panel: document.getElementById('rig-editor-panel'),
    character: document.getElementById('rig-character'),
    motion: document.getElementById('rig-motion'),
    motionNew: document.getElementById('rig-motion-new'),
    canvas: document.getElementById('rig-preview'),
    kfStrip: document.getElementById('rig-keyframe-strip'),
    kfAdd: document.getElementById('rig-kf-add'),
    kfDelete: document.getElementById('rig-kf-delete'),
    kfUp: document.getElementById('rig-kf-up'),
    kfDown: document.getElementById('rig-kf-down'),
    play: document.getElementById('rig-play'),
    kfLabel: document.getElementById('rig-kf-label'),
    kfDuration: document.getElementById('rig-kf-duration'),
    kfEasing: document.getElementById('rig-kf-easing'),
    kfEvent: document.getElementById('rig-kf-event'),
    jointSliders: document.getElementById('rig-joint-sliders'),
    cooldown: document.getElementById('rig-cooldown'),
    exportCopy: document.getElementById('rig-export-copy'),
    exportStatus: document.getElementById('rig-export-status'),
    exportBox: document.getElementById('rig-export'),
  };
  const ctx = els.canvas.getContext('2d');

  const state = {
    characterName: null,
    motionName: null,
    selectedKf: 0,
    player: engine.createMotionPlayer(),
  };

  function currentRig() { return rigs[state.characterName]; }
  function currentMotion() { return currentRig().motions[state.motionName]; }

  function angleMapAtRest() {
    const joints = currentRig().joints;
    const angles = {};
    for (const key of Object.keys(joints)) angles[key] = joints[key].rest;
    return angles;
  }

  function currentSelectedAngles() {
    const kf = currentMotion().keyframes[state.selectedKf];
    return Object.assign(angleMapAtRest(), kf.angles);
  }

  // ---- Boss-specific preview renderer -----------------------------------
  // Mirrors js/game.js's boss proportions so the pose authored here matches
  // what the live game renders. Only the joints CHARACTER_RIGS.boss lists
  // are slider-driven; everything else sits at its fixed rest pose, same
  // as the real boss (only the right arm + torso animate there today).
  const P = {
    HEAD_R: 57, TOP_W: 173, BOTTOM_W: 102, TORSO_H: 167, TORSO_Y_OFFSET: 160,
    SHOULDER_X_INSET: 10, SHOULDER_Y_OFFSET: 9,
    UPPER_LEN: 96, UPPER_W: 40, FORE_LEN: 100, FORE_W: 31,
    HAND_LEN: 45, HAND_W: 26,
  };

  const jointImages = {};
  ['shoulder', 'elbow', 'wrist', 'neck'].forEach((name) => {
    const img = new Image();
    img.src = 'images/joints/' + name + '.svg';
    img.addEventListener('load', renderStaticPose);
    jointImages[name] = img;
  });

  function roundRect(c, x, y, w, h, r) {
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawJointImg(c, x, y, size, name) {
    const img = jointImages[name];
    if (img && img.complete && img.naturalWidth > 0) {
      c.drawImage(img, x - size / 2, y - size / 2, size, size);
      return;
    }
    c.beginPath();
    c.arc(x, y, size / 2, 0, Math.PI * 2);
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#1c0f26';
    c.lineWidth = 1.5;
    c.fill();
    c.stroke();
  }

  function drawArm(c, shoulderX, shoulderY, upperAngle, dir, elbowBend) {
    c.save();
    c.translate(shoulderX, shoulderY);
    c.rotate(upperAngle);
    c.fillStyle = '#4a2f5c';
    roundRect(c, 0, -P.UPPER_W / 2, P.UPPER_LEN * dir, P.UPPER_W, 15);
    c.fill();
    c.strokeStyle = '#1c0f26';
    c.lineWidth = 3;
    roundRect(c, 0, -P.UPPER_W / 2, P.UPPER_LEN * dir, P.UPPER_W, 15);
    c.stroke();
    drawJointImg(c, 0, 0, 20, 'shoulder');

    c.translate(P.UPPER_LEN * dir, 0);
    c.rotate(elbowBend * dir);
    c.fillStyle = '#3a2249';
    roundRect(c, 0, -P.FORE_W / 2, P.FORE_LEN * dir, P.FORE_W, 12);
    c.fill();
    c.strokeStyle = '#1c0f26';
    c.lineWidth = 3;
    roundRect(c, 0, -P.FORE_W / 2, P.FORE_LEN * dir, P.FORE_W, 12);
    c.stroke();
    drawJointImg(c, 0, 0, 16, 'elbow');

    c.translate(P.FORE_LEN * dir, 0);
    drawJointImg(c, 0, 0, 15, 'wrist');

    // Hand -- turned 90deg off the forearm's line instead of continuing
    // straight out (no independent wrist-bend control yet, just this fixed
    // offset).
    c.rotate((Math.PI / 2) * dir);
    c.fillStyle = '#2c1a38';
    roundRect(c, 0, -P.HAND_W / 2, P.HAND_LEN * dir, P.HAND_W, 6);
    c.fill();
    c.strokeStyle = '#1c0f26';
    c.lineWidth = 2.5;
    roundRect(c, 0, -P.HAND_W / 2, P.HAND_LEN * dir, P.HAND_W, 6);
    c.stroke();
    c.restore();
  }

  function rotateAround(px, py, cx, cy, angle) {
    const dx = px - cx, dy = py - cy;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  }

  function drawBossPreview(c, angles) {
    const W = els.canvas.width, H = els.canvas.height;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#c9f0ff';
    c.fillRect(0, 0, W, H);

    const scale = 0.62;
    c.save();
    c.translate(W / 2, H - 30);
    c.scale(scale, scale);

    const bossX = 0;
    const torsoY = -P.TORSO_Y_OFFSET;
    const pivotX = bossX, pivotY = torsoY + P.TORSO_H;
    const torsoAngle = angles.torso || 0;
    const rot = (x, y) => rotateAround(x, y, pivotX, pivotY, torsoAngle);

    const topL = bossX - P.TOP_W / 2, topR = bossX + P.TOP_W / 2;
    const botL = bossX - P.BOTTOM_W / 2, botR = bossX + P.BOTTOM_W / 2;

    const restJoints = currentRig().joints;
    function angleOf(key) {
      return key in angles ? angles[key] : restJoints[key].rest;
    }

    // Torso drawn first so the upper arm / forearm / hand segments layer
    // in front of it (per the "arms in front of the body" layering call).
    const topLp = rot(topL, torsoY), topRp = rot(topR, torsoY);
    const botRp = rot(botR, torsoY + P.TORSO_H), botLp = rot(botL, torsoY + P.TORSO_H);
    c.beginPath();
    c.moveTo(topLp.x, topLp.y);
    c.lineTo(topRp.x, topRp.y);
    c.lineTo(botRp.x, botRp.y);
    c.lineTo(botLp.x, botLp.y);
    c.closePath();
    c.fillStyle = '#3a2249';
    c.fill();
    c.strokeStyle = '#1c0f26';
    c.lineWidth = 4;
    c.stroke();

    const rightShoulder = rot(topR - P.SHOULDER_X_INSET, torsoY + P.SHOULDER_Y_OFFSET);
    const leftShoulder = rot(topL + P.SHOULDER_X_INSET, torsoY + P.SHOULDER_Y_OFFSET);
    drawArm(c, rightShoulder.x, rightShoulder.y, torsoAngle + angleOf('rightShoulder'), 1, angleOf('rightElbow'));
    drawArm(c, leftShoulder.x, leftShoulder.y, torsoAngle - angleOf('leftShoulder'), -1, angleOf('leftElbow'));

    const head = rot(bossX, torsoY - P.HEAD_R + 14);
    c.beginPath();
    c.arc(head.x, head.y, P.HEAD_R, 0, Math.PI * 2);
    c.fillStyle = '#4a2f5c';
    c.fill();
    c.strokeStyle = '#1c0f26';
    c.lineWidth = 4;
    c.stroke();
    drawJointImg(c, head.x, head.y + P.HEAD_R - 2, 12, 'neck');
    c.fillStyle = '#ffb347';
    c.beginPath();
    c.arc(head.x - 18, head.y - 4, 6, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(head.x + 18, head.y - 4, 6, 0, Math.PI * 2);
    c.fill();

    c.restore();
  }

  function renderStaticPose() {
    if (state.player.playing) return;
    drawBossPreview(ctx, currentSelectedAngles());
  }

  // ---- Playback -----------------------------------------------------------
  let rafId = null;
  function playLoop() {
    const motion = currentMotion();
    const angles = engine.updateMotionPlayer(state.player, motion, performance.now(), () => {});
    if (angles) drawBossPreview(ctx, Object.assign(angleMapAtRest(), angles));
    if (state.player.playing) {
      rafId = requestAnimationFrame(playLoop);
    } else {
      renderStaticPose();
    }
  }

  els.play.addEventListener('click', () => {
    engine.playMotion(state.player, performance.now());
    if (rafId) cancelAnimationFrame(rafId);
    playLoop();
  });

  // ---- Joint sliders --------------------------------------------------------
  function buildJointSliders() {
    els.jointSliders.innerHTML = '';
    const joints = currentRig().joints;
    for (const key of Object.keys(joints)) {
      const def = joints[key];
      const row = document.createElement('label');
      row.className = 'rig-joint-slider';
      const valueSpan = document.createElement('span');
      valueSpan.className = 'rig-joint-value';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = def.range[0];
      input.max = def.range[1];
      input.step = 0.01;
      input.dataset.joint = key;
      input.addEventListener('input', () => {
        currentMotion().keyframes[state.selectedKf].angles[key] = parseFloat(input.value);
        valueSpan.textContent = Number(input.value).toFixed(2);
        renderStaticPose();
        refreshExport();
      });
      row.appendChild(document.createTextNode(def.label + ' '));
      row.appendChild(input);
      row.appendChild(valueSpan);
      els.jointSliders.appendChild(row);
    }
  }

  function syncSlidersToSelectedKeyframe() {
    const angles = currentSelectedAngles();
    els.jointSliders.querySelectorAll('input[type=range]').forEach((input) => {
      const key = input.dataset.joint;
      input.value = angles[key];
      input.nextSibling.textContent = Number(angles[key]).toFixed(2);
    });
  }

  // ---- Keyframe list --------------------------------------------------------
  function renderKeyframeStrip() {
    const motion = currentMotion();
    els.kfStrip.innerHTML = '';
    motion.keyframes.forEach((kf, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = (i + 1) + '. ' + (kf.label || '(라벨 없음)');
      btn.className = 'rig-kf-btn' + (i === state.selectedKf ? ' is-selected' : '');
      btn.addEventListener('click', () => {
        state.selectedKf = i;
        loadKeyframeIntoControls();
        renderKeyframeStrip();
        renderStaticPose();
      });
      els.kfStrip.appendChild(btn);
    });
    els.kfDelete.disabled = motion.keyframes.length <= 2;
    els.kfAdd.disabled = motion.keyframes.length >= 6;
    els.kfUp.disabled = state.selectedKf <= 1;
    els.kfDown.disabled = state.selectedKf === 0 || state.selectedKf >= motion.keyframes.length - 1;
  }

  function loadKeyframeIntoControls() {
    const motion = currentMotion();
    const kf = motion.keyframes[state.selectedKf];
    const isFirst = state.selectedKf === 0;
    els.kfLabel.value = kf.label || '';
    els.kfDuration.value = isFirst ? 0 : (kf.duration || 0);
    els.kfDuration.disabled = isFirst;
    els.kfEasing.value = kf.easing || 'linear';
    els.kfEasing.disabled = isFirst;
    els.kfEvent.value = kf.event || '';
    els.cooldown.value = motion.cooldownMs || 0;
    syncSlidersToSelectedKeyframe();
  }

  els.kfAdd.addEventListener('click', () => {
    const motion = currentMotion();
    if (motion.keyframes.length >= 6) return;
    const prevKf = motion.keyframes[motion.keyframes.length - 1];
    motion.keyframes.push({
      label: '새 키프레임',
      duration: 300,
      easing: 'easeOutCubic',
      angles: Object.assign({}, prevKf.angles),
    });
    state.selectedKf = motion.keyframes.length - 1;
    renderKeyframeStrip();
    loadKeyframeIntoControls();
    renderStaticPose();
    refreshExport();
  });

  els.kfDelete.addEventListener('click', () => {
    const motion = currentMotion();
    if (motion.keyframes.length <= 2) return;
    motion.keyframes.splice(state.selectedKf, 1);
    state.selectedKf = Math.max(0, state.selectedKf - 1);
    renderKeyframeStrip();
    loadKeyframeIntoControls();
    renderStaticPose();
    refreshExport();
  });

  els.kfUp.addEventListener('click', () => {
    const motion = currentMotion();
    const i = state.selectedKf;
    if (i <= 1) return;
    const tmp = motion.keyframes[i - 1];
    motion.keyframes[i - 1] = motion.keyframes[i];
    motion.keyframes[i] = tmp;
    state.selectedKf = i - 1;
    renderKeyframeStrip();
    loadKeyframeIntoControls();
    refreshExport();
  });

  els.kfDown.addEventListener('click', () => {
    const motion = currentMotion();
    const i = state.selectedKf;
    if (i === 0 || i >= motion.keyframes.length - 1) return;
    const tmp = motion.keyframes[i + 1];
    motion.keyframes[i + 1] = motion.keyframes[i];
    motion.keyframes[i] = tmp;
    state.selectedKf = i + 1;
    renderKeyframeStrip();
    loadKeyframeIntoControls();
    refreshExport();
  });

  els.kfLabel.addEventListener('input', () => {
    currentMotion().keyframes[state.selectedKf].label = els.kfLabel.value;
    renderKeyframeStrip();
    refreshExport();
  });
  els.kfDuration.addEventListener('input', () => {
    currentMotion().keyframes[state.selectedKf].duration = parseFloat(els.kfDuration.value) || 0;
    refreshExport();
  });
  els.kfEasing.addEventListener('change', () => {
    currentMotion().keyframes[state.selectedKf].easing = els.kfEasing.value;
    refreshExport();
  });
  els.kfEvent.addEventListener('input', () => {
    const v = els.kfEvent.value.trim();
    const kf = currentMotion().keyframes[state.selectedKf];
    if (v) kf.event = v; else delete kf.event;
    refreshExport();
  });
  els.cooldown.addEventListener('input', () => {
    currentMotion().cooldownMs = parseFloat(els.cooldown.value) || 0;
    refreshExport();
  });

  // ---- Character / motion selection --------------------------------------
  function populateCharacterSelect() {
    els.character.innerHTML = '';
    Object.keys(rigs).forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      els.character.appendChild(opt);
    });
    state.characterName = els.character.value;
  }

  function populateMotionSelect() {
    els.motion.innerHTML = '';
    Object.keys(currentRig().motions).forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      els.motion.appendChild(opt);
    });
    state.motionName = els.motion.value;
  }

  els.motionNew.addEventListener('click', () => {
    const name = prompt('새 동작 이름 (영문 camelCase 권장)');
    if (!name) return;
    const restAngles = angleMapAtRest();
    currentRig().motions[name] = {
      cooldownMs: 1500,
      keyframes: [
        { label: '준비 자세', angles: Object.assign({}, restAngles) },
        { label: '키프레임 1', duration: 300, easing: 'easeOutCubic', angles: Object.assign({}, restAngles) },
      ],
    };
    populateMotionSelect();
    els.motion.value = name;
    state.motionName = name;
    state.selectedKf = 0;
    renderKeyframeStrip();
    loadKeyframeIntoControls();
    renderStaticPose();
    refreshExport();
  });

  els.character.addEventListener('change', () => {
    state.characterName = els.character.value;
    populateMotionSelect();
    buildJointSliders();
    state.selectedKf = 0;
    renderKeyframeStrip();
    loadKeyframeIntoControls();
    renderStaticPose();
    refreshExport();
  });

  els.motion.addEventListener('change', () => {
    state.motionName = els.motion.value;
    state.selectedKf = 0;
    renderKeyframeStrip();
    loadKeyframeIntoControls();
    renderStaticPose();
    refreshExport();
  });

  // ---- Export ---------------------------------------------------------------
  function serializeMotion(motion) {
    const lines = ['{', '  cooldownMs: ' + (motion.cooldownMs || 0) + ',', '  keyframes: ['];
    motion.keyframes.forEach((kf, i) => {
      const parts = ['label: ' + JSON.stringify(kf.label || '')];
      if (i > 0) {
        parts.push('duration: ' + (kf.duration || 0));
        parts.push('easing: ' + JSON.stringify(kf.easing || 'linear'));
      }
      if (kf.event) parts.push('event: ' + JSON.stringify(kf.event));
      const angleStr = Object.keys(kf.angles)
        .map((k) => k + ': ' + Number(kf.angles[k]).toFixed(3))
        .join(', ');
      parts.push('angles: { ' + angleStr + ' }');
      lines.push('    { ' + parts.join(', ') + ' },');
    });
    lines.push('  ],', '}');
    return lines.join('\n');
  }

  function refreshExport() {
    const code = 'CHARACTER_RIGS.' + state.characterName + '.motions.' + state.motionName +
      ' = ' + serializeMotion(currentMotion()) + ';';
    els.exportBox.value = code;
  }

  els.exportCopy.addEventListener('click', () => {
    navigator.clipboard.writeText(els.exportBox.value).then(
      () => { els.exportStatus.textContent = '복사됨!'; },
      () => { els.exportBox.select(); els.exportStatus.textContent = '수동으로 복사해주세요 (Ctrl+C)'; }
    ).finally(() => {
      setTimeout(() => { els.exportStatus.textContent = ''; }, 2000);
    });
  });

  // ---- Toggle + init ----------------------------------------------------------
  // While the editor panel is open, the game underneath is hidden so only
  // the editor shows; closing it brings the game back.
  const gameContainer = document.getElementById('game-container');
  els.toggle.addEventListener('click', () => {
    const isHidden = els.panel.hidden;
    els.panel.hidden = !isHidden;
    if (gameContainer) gameContainer.hidden = isHidden;
    els.toggle.textContent = isHidden ? '🛠 리그 에디터 닫기' : '🛠 리그 에디터 열기';
    if (isHidden) renderStaticPose();
  });

  populateCharacterSelect();
  populateMotionSelect();
  buildJointSliders();
  renderKeyframeStrip();
  loadKeyframeIntoControls();
  refreshExport();
  renderStaticPose();
})();
