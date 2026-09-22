(() => {
  'use strict';

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  const WIDTH = canvas.width;
  const HEIGHT = canvas.height;
  const GRAVITY = 0.6;
  const MOVE_SPEED = 4.5;
  const JUMP_FORCE_NORMAL = -11;
  const JUMP_FORCE_MIN = -8;
  const JUMP_FORCE_MAX = -17;
  const JUMP_CHARGE_MS = 700;
  const CHARGE_JUMP_TRAIL_MS = 220;
  const WALL_JUMP_VX = 6;
  const WALL_JUMP_LOCK_MS = 180;
  const DOUBLE_JUMP_FORCE = -12;
  const DASH_SPEED = 14;
  const DASH_DURATION_MS = 180;
  const EFFECT_DURATION_MS = 350;
  const TRAIL_DURATION_MS = 200;
  const ATTACK_DURATION_MS = 280;
  const UP_ATTACK_DURATION_MS = 90;
  const ATTACK_COOLDOWN_MS = 550;
  const AIR_ATTACK_RANGE = 68;
  const UP_ATTACK_SWEEP = Math.PI / 6;
  // The up-attack rises by interpolating position against real elapsed
  // time (see update()), covering the same total height as a plain
  // jump's apex (v^2 / 2g) regardless of the display's refresh rate.
  const JUMP_APEX_HEIGHT = (JUMP_FORCE_NORMAL * JUMP_FORCE_NORMAL) / (2 * GRAVITY);
  const AFTERIMAGE_DURATION_MS = 400;
  const GROUND_Y = HEIGHT - 40;

  const keys = {
    left: false,
    right: false,
    up: false,
    down: false,
  };

  const player = {
    x: 100,
    y: GROUND_Y - 40,
    width: 32,
    height: 40,
    vx: 0,
    vy: 0,
    onGround: false,
    facing: 1,
    charging: false,
    chargeStart: 0,
    jumpCharge: 0,
    touchWall: 0,
    wallCling: false,
    wallJumpLockUntil: 0,
    doubleJumpReady: true,
    chargeWallSide: 0,
    dashReady: true,
    dashUntil: 0,
    chargeJumpTrailUntil: 0,
    attacking: false,
    attackUp: false,
    attackStart: 0,
    attackStartY: 0,
    attackUntil: 0,
    attackDuration: ATTACK_DURATION_MS,
    attackCooldownUntil: 0,
  };

  let effects = [];
  let trail = [];
  let afterimages = [];

  function spawnEffect(x, y) {
    effects.push({ x, y, start: performance.now() });
  }

  function spawnTrail() {
    trail.push({ x: player.x, y: player.y, start: performance.now() });
  }

  function spawnAfterimage(cx, cy, startAngle, endAngle) {
    afterimages.push({ cx, cy, startAngle, endAngle, start: performance.now() });
  }

  // Refreshes both air moves at once: called on landing, on wall contact,
  // and (future) when a hit lands on an opponent.
  function refreshAerialMoves() {
    player.doubleJumpReady = true;
    player.dashReady = true;
  }

  function makePlatform(x, y, w, h) {
    return { x, y, w, h };
  }

  const WALL_HEIGHT = 300;

  const platforms = [
    makePlatform(0, GROUND_Y, WIDTH, HEIGHT - GROUND_Y),
    makePlatform(260, GROUND_Y - WALL_HEIGHT, 40, WALL_HEIGHT),
    makePlatform(WIDTH - 300, GROUND_Y - WALL_HEIGHT, 40, WALL_HEIGHT),
    makePlatform(WIDTH / 2 - 100, GROUND_Y - 260, 200, 20),
  ];

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.width > b.x && a.y < b.y + b.h && a.y + a.height > b.y;
  }

  function launchFromWall(vy, side) {
    const dir = -(side || player.touchWall);
    player.vy = vy;
    player.vx = dir * WALL_JUMP_VX;
    player.facing = dir;
    player.wallJumpLockUntil = performance.now() + WALL_JUMP_LOCK_MS;
    player.wallCling = false;
    player.touchWall = 0;
    player.onGround = false;
  }

  function startJumpCharge() {
    if ((player.onGround || player.wallCling) && !player.charging) {
      player.charging = true;
      player.chargeStart = performance.now();
      player.chargeWallSide = player.wallCling ? player.touchWall : 0;
    }
  }

  function instantJump() {
    if (player.charging) return;
    if (player.wallCling) {
      launchFromWall(JUMP_FORCE_NORMAL);
    } else if (player.onGround) {
      player.vy = JUMP_FORCE_NORMAL;
      player.onGround = false;
    }
  }

  function doubleJump() {
    player.vy = DOUBLE_JUMP_FORCE;
    player.doubleJumpReady = false;
    spawnEffect(player.x + player.width / 2, player.y + player.height);
  }

  function dash() {
    if (!player.dashReady || player.charging || player.attacking) return;
    player.vx = player.facing * DASH_SPEED;
    player.vy = 0;
    player.dashUntil = performance.now() + DASH_DURATION_MS;
    player.dashReady = false;
    spawnTrail();
  }

  function attack() {
    if (player.attacking || player.charging) return;
    const now = performance.now();
    if (now < player.attackCooldownUntil) return;
    player.attacking = true;
    player.attackUp = keys.up;
    player.attackDuration = player.attackUp ? UP_ATTACK_DURATION_MS : ATTACK_DURATION_MS;
    if (player.attackUp) {
      // The up-attack fully overrides gravity for its own rise, so any
      // momentum carried into it is discarded outright -- unlike the
      // regular attack below, which only softens gravity and keeps
      // whatever motion the player already had.
      player.vy = 0;
    } else {
      // Cut any existing fall speed so the spin reads as a brief hover
      // (harmless if grounded, since vy is already ~0 there).
      player.vy = Math.min(player.vy, 1.5);
    }
    player.attackStart = now;
    player.attackStartY = player.y;
    player.attackUntil = now + player.attackDuration;
  }

  // Current attack's hitbox (a circle around the character), for future
  // enemy-collision code to query. Landing a hit should call
  // refreshAerialMoves() when that's wired up.
  function getAttackHitbox() {
    if (!player.attacking) return null;
    return {
      type: 'circle',
      x: player.x + player.width / 2,
      y: player.y + player.height / 2,
      r: AIR_ATTACK_RANGE,
    };
  }

  function doJump() {
    if (player.attacking) return;
    if (player.onGround || player.wallCling) {
      if (keys.up || keys.down) {
        startJumpCharge();
      } else {
        instantJump();
      }
      return;
    }
    // Airborne with no ground/wall contact: only a plain double jump is
    // allowed here (no charging), and only once until it's refreshed by
    // refreshAerialMoves() — called on landing, wall contact, or (future)
    // landing a hit on an opponent.
    if (player.doubleJumpReady) {
      doubleJump();
    }
  }

  function releaseJumpCharge() {
    if (!player.charging) return;
    const t = Math.min(1, (performance.now() - player.chargeStart) / JUMP_CHARGE_MS);
    const vy = JUMP_FORCE_MIN + (JUMP_FORCE_MAX - JUMP_FORCE_MIN) * t;
    if (player.wallCling) {
      launchFromWall(vy, player.chargeWallSide);
    } else {
      player.vy = vy;
      player.onGround = false;
    }
    player.charging = false;
    player.jumpCharge = 0;
    player.chargeWallSide = 0;
    player.chargeJumpTrailUntil = performance.now() + CHARGE_JUMP_TRAIL_MS;
    spawnTrail();
  }

  // The bent-boomerang weapon shape: two tapered arms meeting at an elbow
  // kinked sideways off the swing line, at the given angle around (cx, cy).
  function drawBoomerang(cx, cy, angle, dir, fade) {
    const baseR = AIR_ATTACK_RANGE * 0.15;
    const elbowR = AIR_ATTACK_RANGE * 0.55;
    const bendOffset = AIR_ATTACK_RANGE * 0.25;

    const baseCX = cx + Math.cos(angle) * baseR;
    const baseCY = cy + Math.sin(angle) * baseR;
    const elbowCX = cx + Math.cos(angle) * elbowR - Math.sin(angle) * bendOffset * dir;
    const elbowCY = cy + Math.sin(angle) * elbowR + Math.cos(angle) * bendOffset * dir;
    const tipX = cx + Math.cos(angle) * AIR_ATTACK_RANGE;
    const tipY = cy + Math.sin(angle) * AIR_ATTACK_RANGE;

    const dir1 = Math.atan2(elbowCY - baseCY, elbowCX - baseCX);
    const perp1X = -Math.sin(dir1);
    const perp1Y = Math.cos(dir1);
    const dir2 = Math.atan2(tipY - elbowCY, tipX - elbowCX);
    const perp2X = -Math.sin(dir2);
    const perp2Y = Math.cos(dir2);

    ctx.fillStyle = `rgba(10, 10, 10, ${fade})`;

    ctx.beginPath();
    ctx.moveTo(baseCX + perp1X * 9, baseCY + perp1Y * 9);
    ctx.lineTo(elbowCX, elbowCY);
    ctx.lineTo(baseCX - perp1X * 9, baseCY - perp1Y * 9);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(elbowCX + perp2X * 12, elbowCY + perp2Y * 12);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(elbowCX - perp2X * 12, elbowCY - perp2Y * 12);
    ctx.closePath();
    ctx.fill();
  }

  function update() {
    const now0 = performance.now();
    const wallJumpLocked = now0 < player.wallJumpLockUntil;
    const wallCharging = player.charging && player.chargeWallSide !== 0;
    const dashing = now0 < player.dashUntil;

    if (now0 < player.chargeJumpTrailUntil) {
      spawnTrail();
    }

    if (dashing) {
      // Straight-line burst in the facing direction: input is ignored and
      // gravity is paused for the dash's short duration.
      player.vx = player.facing * DASH_SPEED;
      spawnTrail();
    } else if (wallCharging) {
      // Anchored to the wall while charging: ignore movement input entirely
      // so pressing away from the wall can't turn the frozen-gravity cling
      // into a horizontal flight.
      player.vx = 0;
    } else if (player.attacking) {
      // Attacks (ground spin or up-flick alike) root the character in
      // place horizontally; only the up-attack's own vertical rise moves
      // them, set separately below.
      player.vx = 0;
    } else if (!wallJumpLocked) {
      if (keys.left) {
        player.vx = -MOVE_SPEED;
        player.facing = -1;
      } else if (keys.right) {
        player.vx = MOVE_SPEED;
        player.facing = 1;
      } else {
        player.vx = 0;
      }
    }

    if (player.charging) {
      player.jumpCharge = Math.min(1, (performance.now() - player.chargeStart) / JUMP_CHARGE_MS);
    }

    if (dashing) {
      player.vy = 0;
    } else if (player.attacking && player.attackUp) {
      // Rise while flicking the boomerang upward, leaving a fresh afterimage
      // behind (fading in place) at every frame's position. Target position
      // is interpolated against real elapsed time (not a fixed px/frame
      // speed), so the total rise matches JUMP_APEX_HEIGHT regardless of
      // the display's refresh rate.
      const upT = Math.min(1, (now0 - player.attackStart) / player.attackDuration);
      const targetY = player.attackStartY - JUMP_APEX_HEIGHT * upT;
      player.vy = targetY - player.y;
      const upCX = player.x + player.width / 2;
      const upCY = player.y + player.height / 2;
      const upStartAngle = player.facing === 1 ? 0 : Math.PI;
      const upDir = player.facing === 1 ? 1 : -1;
      const upAngle = upStartAngle - upDir * UP_ATTACK_SWEEP * upT;
      spawnAfterimage(upCX, upCY, Math.min(upAngle, upStartAngle), Math.max(upAngle, upStartAngle));
    } else {
      player.vy += GRAVITY * (player.attacking ? 0.12 : 1);
      if (player.vy > 18) player.vy = 18;
    }

    const wasOnGround = player.onGround;

    player.x += player.vx;
    if (player.x < 0) player.x = 0;
    if (player.x > WIDTH - player.width) player.x = WIDTH - player.width;

    player.touchWall = 0;
    for (const p of platforms) {
      if (rectsOverlap(player, p)) {
        if (player.vx > 0) {
          player.x = p.x - player.width;
          player.touchWall = 1;
        } else if (player.vx < 0) {
          player.x = p.x + p.w;
          player.touchWall = -1;
        }
      }
    }

    player.wallCling =
      !wasOnGround &&
      ((player.touchWall === 1 && keys.right) || (player.touchWall === -1 && keys.left));

    if (player.charging && player.chargeWallSide !== 0) {
      player.wallCling = true;
    }

    if (player.wallCling) {
      player.vy = 0;
    }

    player.onGround = false;
    const nextY = { ...player, y: player.y + player.vy };

    for (const p of platforms) {
      if (rectsOverlap(nextY, p)) {
        if (player.vy >= 0 && player.y + player.height <= p.y + 1) {
          player.y = p.y - player.height;
          player.vy = 0;
          player.onGround = true;
        } else if (player.vy < 0 && player.y >= p.y + p.h - 1) {
          player.y = p.y + p.h;
          player.vy = 0;
        }
      }
    }

    if (!player.onGround) {
      player.y += player.vy;
    }

    if (player.onGround || player.wallCling) {
      refreshAerialMoves();
    }

    if (player.charging && !player.onGround && !player.wallCling) {
      player.charging = false;
      player.jumpCharge = 0;
    }

    const now = performance.now();
    effects = effects.filter((e) => now - e.start < EFFECT_DURATION_MS);
    trail = trail.filter((t) => now - t.start < TRAIL_DURATION_MS);
    afterimages = afterimages.filter((a) => now - a.start < AFTERIMAGE_DURATION_MS);

    if (player.attacking && now >= player.attackUntil) {
      const wasUpAttack = player.attackUp;
      player.attacking = false;
      player.attackUp = false;
      player.attackCooldownUntil = now + ATTACK_COOLDOWN_MS;
      if (wasUpAttack) {
        // Stop overriding gravity the instant the up-attack ends so the
        // character drops from rest instead of carrying its rise speed.
        player.vy = 0;
      }
    }
  }

  function resetPlayer() {
    player.x = 100;
    player.y = GROUND_Y - player.height;
    player.vx = 0;
    player.vy = 0;
    player.charging = false;
    player.jumpCharge = 0;
    player.touchWall = 0;
    player.wallCling = false;
    player.wallJumpLockUntil = 0;
    player.doubleJumpReady = true;
    player.chargeWallSide = 0;
    player.dashReady = true;
    player.dashUntil = 0;
    player.chargeJumpTrailUntil = 0;
    player.attacking = false;
    player.attackUp = false;
    player.attackStartY = 0;
    player.attackUntil = 0;
    player.attackDuration = ATTACK_DURATION_MS;
    player.attackCooldownUntil = 0;
    effects = [];
    trail = [];
    afterimages = [];
  }

  function draw() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    const skyGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    skyGrad.addColorStop(0, '#87ceeb');
    skyGrad.addColorStop(1, '#c9f0ff');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    for (const p of platforms) {
      const isWall = p.w < p.h;
      ctx.fillStyle = isWall ? '#6b6b6b' : p.h > 30 ? '#5a3d2b' : '#3d8b3d';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      if (!isWall) {
        ctx.fillStyle = '#3d8b3d';
        ctx.fillRect(p.x, p.y, p.w, 8);
      }
    }

    const now = performance.now();
    for (const t of trail) {
      const p = (now - t.start) / TRAIL_DURATION_MS;
      ctx.fillStyle = `rgba(233, 69, 96, ${0.35 * (1 - p)})`;
      ctx.fillRect(t.x, t.y, player.width, player.height);
    }

    for (const e of effects) {
      const t = (now - e.start) / EFFECT_DURATION_MS;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 6 + t * 20, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${1 - t})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    for (const a of afterimages) {
      const p = (now - a.start) / AFTERIMAGE_DURATION_MS;
      ctx.beginPath();
      ctx.moveTo(a.cx, a.cy);
      ctx.arc(a.cx, a.cy, AIR_ATTACK_RANGE, a.startAngle, a.endAngle);
      ctx.closePath();
      ctx.fillStyle = `rgba(255, 255, 255, ${0.5 * (1 - p)})`;
      ctx.fill();
    }

    if (player.attacking) {
      const t = (now - player.attackStart) / player.attackDuration;
      const fade = 1 - t;
      const cx = player.x + player.width / 2;
      const cy = player.y + player.height / 2;
      const startAngle = player.facing === 1 ? 0 : Math.PI;
      const dir = player.facing === 1 ? 1 : -1;

      if (player.attackUp) {
        // A short 30-degree flick from the facing direction up towards
        // "up", leaving a white afterimage wedge behind as it swings.
        const angle = startAngle - dir * UP_ATTACK_SWEEP * Math.min(1, t);

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, AIR_ATTACK_RANGE, Math.min(angle, startAngle), Math.max(angle, startAngle));
        ctx.closePath();
        ctx.fillStyle = `rgba(255, 255, 255, ${0.6 * fade})`;
        ctx.fill();

        drawBoomerang(cx, cy, angle, dir, fade);
      } else {
        // A single rod sweeps one full circle (front -> down -> back -> up
        // -> front); a feathered wedge trails behind its tip as an
        // afterimage instead of a plain stroke. Facing right spins
        // clockwise (angle increasing); facing left mirrors it to
        // counter-clockwise (angle decreasing).
        const angle = startAngle + dir * t * Math.PI * 2;
        const trailSpan = Math.PI * 0.6;
        const trailStart = dir === 1 ? angle - trailSpan : angle;
        const trailEnd = dir === 1 ? angle : angle + trailSpan;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, AIR_ATTACK_RANGE, trailStart, trailEnd);
        ctx.closePath();
        const wedgeGrad = ctx.createRadialGradient(cx, cy, AIR_ATTACK_RANGE * 0.1, cx, cy, AIR_ATTACK_RANGE);
        wedgeGrad.addColorStop(0, `rgba(210, 245, 255, ${0.4 * fade})`);
        wedgeGrad.addColorStop(1, `rgba(120, 215, 255, ${fade})`);
        ctx.fillStyle = wedgeGrad;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(cx, cy, AIR_ATTACK_RANGE, trailStart, trailEnd);
        ctx.strokeStyle = `rgba(230, 250, 255, ${fade})`;
        ctx.lineWidth = 3.5;
        ctx.stroke();

        const hatchCount = 8;
        for (let i = 0; i <= hatchCount; i++) {
          const a = angle - dir * trailSpan * (i / hatchCount);
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * AIR_ATTACK_RANGE * 0.2, cy + Math.sin(a) * AIR_ATTACK_RANGE * 0.2);
          ctx.lineTo(cx + Math.cos(a) * AIR_ATTACK_RANGE, cy + Math.sin(a) * AIR_ATTACK_RANGE);
          ctx.strokeStyle = `rgba(255, 255, 255, ${fade * 0.9})`;
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }

        // The weapon: an actual bent boomerang, not a straight taper -- two
        // tapered arms meeting at an elbow that's kinked sideways off the
        // swing line (thin jagged hatch lines above are the afterimage,
        // not this shape).
        drawBoomerang(cx, cy, angle, dir, fade);
      }
    }

    ctx.fillStyle = '#e94560';
    ctx.fillRect(player.x, player.y, player.width, player.height);

    ctx.beginPath();
    ctx.arc(player.x + player.width / 2, player.y - 10, 4, 0, Math.PI * 2);
    ctx.fillStyle = player.doubleJumpReady ? '#66e0ff' : 'rgba(255, 255, 255, 0.25)';
    ctx.fill();

    if (player.wallCling) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(player.x + 1, player.y + 1, player.width - 2, player.height - 2);
    }

    ctx.fillStyle = '#fff';
    let eyeX = player.facing === 1 ? player.x + player.width - 10 : player.x + 4;
    let eyeY = player.y + 8;
    if (keys.up) {
      eyeY = player.y + 2;
    } else if (keys.down) {
      eyeY = player.y + player.height - 10;
    }
    ctx.fillRect(eyeX, eyeY, 6, 6);

    if (player.charging) {
      const gaugeW = 8;
      const gaugeH = player.height;
      const gaugeX = player.facing === 1 ? player.x - gaugeW - 6 : player.x + player.width + 6;
      const gaugeY = player.y;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(gaugeX, gaugeY, gaugeW, gaugeH);

      const fillH = gaugeH * player.jumpCharge;
      ctx.fillStyle = player.jumpCharge >= 1 ? '#ffffff' : '#ffcc00';
      ctx.fillRect(gaugeX, gaugeY + gaugeH - fillH, gaugeW, fillH);

      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(gaugeX + 0.5, gaugeY + 0.5, gaugeW - 1, gaugeH - 1);
    }
  }

  function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
  }

  function handleKey(e, isDown) {
    switch (e.code) {
      case 'ArrowLeft':
        keys.left = isDown;
        break;
      case 'ArrowRight':
        keys.right = isDown;
        break;
      case 'ArrowUp':
        keys.up = isDown;
        e.preventDefault();
        break;
      case 'ArrowDown':
        keys.down = isDown;
        e.preventDefault();
        break;
      case 'KeyZ':
        if (isDown) {
          if (!e.repeat) doJump();
        } else {
          releaseJumpCharge();
        }
        break;
      case 'KeyC':
        if (isDown && !e.repeat) dash();
        break;
      case 'KeyX':
        if (isDown && !e.repeat) attack();
        break;
    }
  }

  window.addEventListener('keydown', (e) => handleKey(e, true));
  window.addEventListener('keyup', (e) => handleKey(e, false));

  function bindHold(el, onDown, onUp) {
    const start = (e) => {
      e.preventDefault();
      onDown();
    };
    const end = (e) => {
      e.preventDefault();
      onUp();
    };
    el.addEventListener('touchstart', start, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('mousedown', start);
    el.addEventListener('mouseup', end);
    el.addEventListener('mouseleave', end);
  }

  const btnLeft = document.getElementById('btn-left');
  const btnRight = document.getElementById('btn-right');
  const btnJump = document.getElementById('btn-jump');

  bindHold(btnLeft, () => (keys.left = true), () => (keys.left = false));
  bindHold(btnRight, () => (keys.right = true), () => (keys.right = false));
  bindHold(btnJump, doJump, releaseJumpCharge);

  resetPlayer();
  loop();
})();
