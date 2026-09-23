(() => {
  'use strict';

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  const WIDTH = canvas.width;
  const HEIGHT = canvas.height;
  const GRAVITY = 0.6;
  const MOVE_SPEED = 4.5;
  // Jump/dash/attack-range values below are scaled to roughly the same
  // ~0.7x factor as the player shrink (32x40 -> 22x28), so reach stays
  // proportionate to the smaller character instead of looking oversized.
  const JUMP_FORCE_NORMAL = -9;
  const JUMP_FORCE_MIN = -7;
  const JUMP_FORCE_MAX = -14;
  const JUMP_CHARGE_MS = 700;
  const CHARGE_JUMP_TRAIL_MS = 220;
  const WALL_JUMP_VX = 4;
  const WALL_JUMP_LOCK_MS = 180;
  const DOUBLE_JUMP_FORCE = -10;
  const DASH_SPEED = 10;
  const DASH_DURATION_MS = 180;
  const EFFECT_DURATION_MS = 350;
  const TRAIL_DURATION_MS = 200;
  const ATTACK_DURATION_MS = 280;
  const ATTACK_LOCK_MS = 140; // regular attack only: how long horizontal movement stays locked
  const UP_ATTACK_DURATION_MS = 90;
  const ATTACK_COOLDOWN_MS = 275;
  const UP_ATTACK_COOLDOWN_MS = 550;
  const AIR_ATTACK_RANGE = 48;
  const UP_ATTACK_SWEEP = Math.PI / 6;
  // The up-attack rises by interpolating position against real elapsed
  // time (see update()), covering the same total height as a plain
  // jump's apex (v^2 / 2g) regardless of the display's refresh rate.
  const JUMP_APEX_HEIGHT = (JUMP_FORCE_NORMAL * JUMP_FORCE_NORMAL) / (2 * GRAVITY);
  const UP_ATTACK_SLOWFALL_MS = 150;
  const UP_ATTACK_SLOWFALL_GRAVITY_MULT = 0.25;
  const MAX_VERTICAL_STEP = 8; // smaller than the thinnest platform (20px)
  const AFTERIMAGE_DURATION_MS = 400;
  const GROUND_Y = HEIGHT - 40;
  const PLAYER_MAX_HP = 10; // 5 hearts, in half-heart units
  const NORMAL_HIT_DAMAGE = 1; // a normal hit costs half a heart
  const ATTACK_GAUGE_MAX = 100;
  const ATTACK_GAUGE_PER_HIT = 15;
  const ATTACK_GAUGE_SEGMENTS = 5; // one segment every 20%
  const HOVER_DURATION_MS = 4000; // how long a full gauge sustains hover
  const HOVER_EFFECT_INTERVAL_MS = 90;
  const HOVER_SLOWFALL_MS = 100; // brief float right after hover ends

  // Giant jointed boss: head + trapezoid torso (buried from the waist down
  // by the ground) + two arms, each with an upper-arm/forearm/fist chain.
  // Static appearance only for now -- no HP, AI, or attack patterns yet.
  const BOSS_SCALE = 2; // fills most of the map, up from the original size
  const BOSS_HEAD_R = 57 * BOSS_SCALE;
  const BOSS_TOP_W = 173 * BOSS_SCALE;
  const BOSS_BOTTOM_W = 102 * BOSS_SCALE;
  const BOSS_TORSO_H = 167 * BOSS_SCALE;
  const BOSS_TORSO_Y_OFFSET = 160 * BOSS_SCALE; // how far above the ground the torso top sits
  const BOSS_SHOULDER_X_INSET = 10 * BOSS_SCALE;
  const BOSS_SHOULDER_Y_OFFSET = 9 * BOSS_SCALE;
  const BOSS_UPPER_LEN = 96 * BOSS_SCALE;
  const BOSS_UPPER_W = 40 * BOSS_SCALE;
  const BOSS_FORE_LEN = 100 * BOSS_SCALE;
  const BOSS_FORE_W = 31 * BOSS_SCALE;
  const BOSS_FIST_R = 27 * BOSS_SCALE;
  const BOSS_FIST_SIZE = BOSS_FIST_R * 2; // square fist, standable and hittable
  const BOSS_ARM_ANGLE = 0.53;
  const BOSS_ELBOW_BEND = 0.45;
  const BOSS_HIT_FLASH_MS = 180;

  // Right-arm "ground pound" pattern: wind up (raise the upper arm, wrist
  // trailing along, elbow straightening a little) then slam straight down.
  const BOSS_RAISED_ANGLE = -0.72; // upper arm angle while wound up (raised overhead)
  const BOSS_RAISED_ELBOW_BEND = 0.25; // elbow straightens some as it's raised
  const BOSS_SLAM_ANGLE = 1.1; // upper arm angle at the bottom of the slam
  const BOSS_SLAM_ELBOW_BEND = 0.3;
  const BOSS_WINDUP_MS = 650;
  const BOSS_SLAM_MS = 180;
  const BOSS_RECOVER_MS = 450;
  const BOSS_PATTERN_COOLDOWN_MS = 1700;
  const BOSS_SLAM_RANGE = 150; // half-width of the ground-pound shockwave
  const BOSS_SLAM_DAMAGE = 2; // a full heart

  const keys = {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
  };

  const player = {
    x: 100,
    y: GROUND_Y - 28,
    width: 22,
    height: 28,
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
    attackLockUntil: 0,
    attackCooldownUntil: 0,
    slowFallUntil: 0,
    hp: PLAYER_MAX_HP,
    attackGauge: 0,
    hovering: false,
    hoverStart: 0,
    hoverGaugeAtStart: 0,
    nextHoverEffectAt: 0,
    hitBossThisAttack: false,
  };

  // Fixed position for now, centered in the gap between the two walls.
  // Only the head and fists are hittable/standable -- torso and arms are not.
  const boss = {
    x: WIDTH / 2,
    groundY: GROUND_Y,
    headFlashUntil: 0,
    leftFistFlashUntil: 0,
    rightFistFlashUntil: 0,
    // Right-arm ground-pound pattern state -- current pose (animated) plus
    // a simple idle -> windup -> slam -> recover loop.
    rightArmAngle: BOSS_ARM_ANGLE,
    rightElbowBend: BOSS_ELBOW_BEND,
    pattern: 'idle',
    patternStart: 0,
    nextPatternAt: performance.now() + 1200,
    slamImpactDone: false,
  };

  function roundRect(x, y, w, h, r) {
    // Normalize negative width/height (the left-arm segments mirror by
    // passing a negative length) -- without this, arcTo's corner math
    // breaks and spikes a stray line out past the shape.
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

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

  function bossShoulderPos(dir) {
    const torsoY = boss.groundY - BOSS_TORSO_Y_OFFSET;
    const x = dir === 1
      ? boss.x + BOSS_TOP_W / 2 - BOSS_SHOULDER_X_INSET
      : boss.x - BOSS_TOP_W / 2 + BOSS_SHOULDER_X_INSET;
    return { x, y: torsoY + BOSS_SHOULDER_Y_OFFSET };
  }

  // Forward kinematics for the shoulder -> elbow -> wrist chain, matching
  // the rotation math used to draw it (see drawBossArm). angle/elbowBend
  // default to the resting pose but the right arm passes its current
  // animated pose while a pattern is playing.
  function bossFistCenter(dir, angle = BOSS_ARM_ANGLE, elbowBend = BOSS_ELBOW_BEND) {
    const shoulder = bossShoulderPos(dir);
    const a1 = angle * dir;
    const x1 = shoulder.x + Math.cos(a1) * BOSS_UPPER_LEN * dir;
    const y1 = shoulder.y + Math.sin(a1) * BOSS_UPPER_LEN * dir;
    const a2 = a1 + elbowBend * dir;
    const x2 = x1 + Math.cos(a2) * BOSS_FORE_LEN * dir;
    const y2 = y1 + Math.sin(a2) * BOSS_FORE_LEN * dir;
    return { x: x2, y: y2 };
  }

  function bossFistRect(dir, angle, elbowBend) {
    const c = bossFistCenter(dir, angle, elbowBend);
    return {
      x: c.x - BOSS_FIST_SIZE / 2,
      y: c.y - BOSS_FIST_SIZE / 2,
      w: BOSS_FIST_SIZE,
      h: BOSS_FIST_SIZE,
      isBossFist: true,
    };
  }

  // Re-positions the (already-created) right fist rect to match the arm's
  // current animated pose -- called every frame so standing/hit collision
  // stays in sync with the pattern. The left fist stays static.
  function refreshBossFistRects() {
    const r = bossFistRect(1, boss.rightArmAngle, boss.rightElbowBend);
    bossRightFist.x = r.x;
    bossRightFist.y = r.y;
  }

  function bossSlamImpact() {
    const fist = bossFistCenter(1, boss.rightArmAngle, boss.rightElbowBend);
    for (let i = -2; i <= 2; i++) {
      spawnEffect(fist.x + i * 24, boss.groundY);
    }
    const playerCX = player.x + player.width / 2;
    if (player.onGround && Math.abs(playerCX - fist.x) < BOSS_SLAM_RANGE) {
      damagePlayer(BOSS_SLAM_DAMAGE);
      player.vy = -8;
      player.vx = (playerCX < fist.x ? -1 : 1) * 6;
      player.onGround = false;
    }
  }

  // idle -> windup (raise arm, elbow straightens) -> slam (swing down hard,
  // impact on landing) -> recover (ease back to resting pose) -> idle.
  function updateBossPattern(now) {
    const t = now - boss.patternStart;
    if (boss.pattern === 'idle') {
      if (now >= boss.nextPatternAt) {
        boss.pattern = 'windup';
        boss.patternStart = now;
      }
      return;
    }
    if (boss.pattern === 'windup') {
      const p = Math.min(1, t / BOSS_WINDUP_MS);
      const e = 1 - Math.pow(1 - p, 3);
      boss.rightArmAngle = BOSS_ARM_ANGLE + (BOSS_RAISED_ANGLE - BOSS_ARM_ANGLE) * e;
      boss.rightElbowBend = BOSS_ELBOW_BEND + (BOSS_RAISED_ELBOW_BEND - BOSS_ELBOW_BEND) * e;
      if (p >= 1) {
        boss.pattern = 'slam';
        boss.patternStart = now;
        boss.slamImpactDone = false;
      }
      return;
    }
    if (boss.pattern === 'slam') {
      const p = Math.min(1, t / BOSS_SLAM_MS);
      const e = p * p * p;
      boss.rightArmAngle = BOSS_RAISED_ANGLE + (BOSS_SLAM_ANGLE - BOSS_RAISED_ANGLE) * e;
      boss.rightElbowBend = BOSS_RAISED_ELBOW_BEND + (BOSS_SLAM_ELBOW_BEND - BOSS_RAISED_ELBOW_BEND) * e;
      if (!boss.slamImpactDone && p >= 1) {
        boss.slamImpactDone = true;
        bossSlamImpact();
      }
      if (p >= 1) {
        boss.pattern = 'recover';
        boss.patternStart = now;
      }
      return;
    }
    if (boss.pattern === 'recover') {
      const p = Math.min(1, t / BOSS_RECOVER_MS);
      const e = 1 - Math.pow(1 - p, 3);
      boss.rightArmAngle = BOSS_SLAM_ANGLE + (BOSS_ARM_ANGLE - BOSS_SLAM_ANGLE) * e;
      boss.rightElbowBend = BOSS_SLAM_ELBOW_BEND + (BOSS_ELBOW_BEND - BOSS_SLAM_ELBOW_BEND) * e;
      if (p >= 1) {
        boss.rightArmAngle = BOSS_ARM_ANGLE;
        boss.rightElbowBend = BOSS_ELBOW_BEND;
        boss.pattern = 'idle';
        boss.nextPatternAt = now + BOSS_PATTERN_COOLDOWN_MS;
      }
    }
  }

  function bossHeadPos() {
    const torsoY = boss.groundY - BOSS_TORSO_Y_OFFSET;
    return { x: boss.x, y: torsoY - BOSS_HEAD_R + 14 * BOSS_SCALE, r: BOSS_HEAD_R };
  }

  const WALL_HEIGHT = 300;

  // Fist rects double as solid platforms (standable/collidable) and as
  // hittable targets -- torso and arms are neither.
  const bossRightFist = bossFistRect(1);
  const bossLeftFist = bossFistRect(-1);

  const platforms = [
    makePlatform(0, GROUND_Y, WIDTH, HEIGHT - GROUND_Y),
    makePlatform(260, GROUND_Y - WALL_HEIGHT, 40, WALL_HEIGHT),
    makePlatform(WIDTH - 300, GROUND_Y - WALL_HEIGHT, 40, WALL_HEIGHT),
    bossRightFist,
    bossLeftFist,
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
    if (!player.dashReady || player.charging || player.attacking || player.hovering) return;
    player.vx = player.facing * DASH_SPEED;
    player.vy = 0;
    player.dashUntil = performance.now() + DASH_DURATION_MS;
    player.dashReady = false;
    spawnTrail();
  }

  // Airborne-only move: holding Up or Down and pressing jump spends the
  // attack gauge to hang in place instead of falling, for as long as Z
  // stays held and the gauge lasts.
  function startHover() {
    const now = performance.now();
    player.hovering = true;
    player.hoverStart = now;
    player.hoverGaugeAtStart = player.attackGauge;
    player.nextHoverEffectAt = now;
  }

  function stopHover(now = performance.now()) {
    if (!player.hovering) return;
    player.hovering = false;
    // A very brief float right after hover ends, instead of dropping
    // straight into full-speed falling.
    player.slowFallUntil = now + HOVER_SLOWFALL_MS;
  }

  // Lets hover kick in from a held jump key too: if the player is already
  // holding Z (e.g. right after using a double jump) and then presses Up
  // or Down, this starts hover without needing a fresh Z press.
  function tryStartHoverFromHeldZ() {
    if (player.attacking || player.onGround || player.wallCling || player.hovering) return;
    if (!keys.jump || player.attackGauge <= 0) return;
    startHover();
  }

  function attack() {
    if (player.attacking || player.charging || player.wallCling || player.hovering) return;
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
    // Only the regular attack releases the horizontal-movement lock early;
    // the up-attack stays locked for its whole (already short) duration.
    player.attackLockUntil = now + (player.attackUp ? player.attackDuration : ATTACK_LOCK_MS);
    player.hitBossThisAttack = false;
  }

  // For a future incoming-damage source (no attacker is wired up yet): a
  // normal hit costs half a heart.
  function damagePlayer(amount = NORMAL_HIT_DAMAGE) {
    player.hp = Math.max(0, player.hp - amount);
  }

  // Current attack's hitbox (a circle around the character).
  function getAttackHitbox() {
    if (!player.attacking) return null;
    return {
      x: player.x + player.width / 2,
      y: player.y + player.height / 2,
      r: AIR_ATTACK_RANGE,
    };
  }

  function circleRectOverlap(cx, cy, r, rect) {
    const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
    const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
    const dx = cx - closestX;
    const dy = cy - closestY;
    return dx * dx + dy * dy <= r * r;
  }

  function circleCircleOverlap(cx1, cy1, r1, cx2, cy2, r2) {
    const dx = cx1 - cx2;
    const dy = cy1 - cy2;
    const rSum = r1 + r2;
    return dx * dx + dy * dy <= rSum * rSum;
  }

  // Only the head and the two fists are hittable -- torso and arms aren't.
  function updateBoss(now) {
    if (!player.attacking || player.hitBossThisAttack) return;
    const hitbox = getAttackHitbox();
    if (!hitbox) return;

    const head = bossHeadPos();
    let hitPart = null;
    if (circleCircleOverlap(hitbox.x, hitbox.y, hitbox.r, head.x, head.y, head.r)) {
      hitPart = 'head';
      boss.headFlashUntil = now + BOSS_HIT_FLASH_MS;
    } else if (circleRectOverlap(hitbox.x, hitbox.y, hitbox.r, bossRightFist)) {
      hitPart = 'rightFist';
      boss.rightFistFlashUntil = now + BOSS_HIT_FLASH_MS;
    } else if (circleRectOverlap(hitbox.x, hitbox.y, hitbox.r, bossLeftFist)) {
      hitPart = 'leftFist';
      boss.leftFistFlashUntil = now + BOSS_HIT_FLASH_MS;
    }

    if (hitPart) {
      player.hitBossThisAttack = true;
      spawnEffect(hitbox.x, hitbox.y);
      refreshAerialMoves();
      player.attackGauge = Math.min(ATTACK_GAUGE_MAX, player.attackGauge + ATTACK_GAUGE_PER_HIT);
    }
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
    // Airborne with no ground/wall contact and a direction held: spend the
    // attack gauge to hover instead, if there's any gauge left.
    if (!player.hovering && (keys.up || keys.down) && player.attackGauge > 0) {
      startHover();
      return;
    }
    // Otherwise, only a plain double jump is allowed here (no charging),
    // and only once until it's refreshed by refreshAerialMoves() — called
    // on landing, wall contact, or (future) landing a hit on an opponent.
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
    updateBossPattern(now0);
    refreshBossFistRects();
    const wallJumpLocked = now0 < player.wallJumpLockUntil;
    const wallCharging = player.charging && player.chargeWallSide !== 0;
    const dashing = now0 < player.dashUntil;

    if (now0 < player.chargeJumpTrailUntil) {
      spawnTrail();
    }

    if (player.hovering) {
      const elapsed = now0 - player.hoverStart;
      const drained = (elapsed / HOVER_DURATION_MS) * ATTACK_GAUGE_MAX;
      player.attackGauge = Math.max(0, player.hoverGaugeAtStart - drained);
      if (player.attackGauge <= 0) {
        stopHover(now0);
      } else if (now0 >= player.nextHoverEffectAt) {
        spawnEffect(player.x + player.width / 2, player.y + player.height);
        player.nextHoverEffectAt = now0 + HOVER_EFFECT_INTERVAL_MS;
      }
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
    } else if (player.attacking && now0 < player.attackLockUntil) {
      // Roots the character in place horizontally while locked; the
      // up-attack's own vertical rise moves them, set separately below.
      // The regular attack's lock ends early (ATTACK_LOCK_MS), letting the
      // player move again while its spin animation keeps playing out.
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

    if (player.hovering) {
      player.vy = 0;
    } else if (dashing) {
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
      let gravityMult = 1;
      if (player.attacking) {
        gravityMult = 0.12;
      } else if (now0 < player.slowFallUntil) {
        // Brief float right after the up-attack ends, before gravity
        // returns to normal.
        gravityMult = UP_ATTACK_SLOWFALL_GRAVITY_MULT;
      }
      player.vy += GRAVITY * gravityMult;
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
    // Resolve vertical movement in small sub-steps instead of one big leap,
    // so a fast vertical move (like the up-attack's rise) can't skip clean
    // over a thin platform or wall edge within a single frame.
    let remainingVy = player.vy;
    while (remainingVy !== 0 && !player.onGround) {
      const step = Math.sign(remainingVy) * Math.min(Math.abs(remainingVy), MAX_VERTICAL_STEP);
      const nextY = { ...player, y: player.y + step };
      let blocked = false;

      for (const p of platforms) {
        if (rectsOverlap(nextY, p)) {
          if (player.vy >= 0 && player.y + player.height <= p.y + 1) {
            player.y = p.y - player.height;
            player.vy = 0;
            player.onGround = true;
            blocked = true;
            break;
          } else if (player.vy < 0 && player.y >= p.y + p.h - 1) {
            player.y = p.y + p.h;
            player.vy = 0;
            blocked = true;
            break;
          }
        }
      }

      if (blocked) break;
      player.y += step;
      remainingVy -= step;
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

    updateBoss(now);

    if (player.attacking && now >= player.attackUntil) {
      const wasUpAttack = player.attackUp;
      player.attacking = false;
      player.attackUp = false;
      player.attackCooldownUntil = now + (wasUpAttack ? UP_ATTACK_COOLDOWN_MS : ATTACK_COOLDOWN_MS);
      if (wasUpAttack) {
        // Stop overriding gravity the instant the up-attack ends so the
        // character drops from rest instead of carrying its rise speed,
        // then float down gently for a moment before gravity ramps back up.
        player.vy = 0;
        player.slowFallUntil = now + UP_ATTACK_SLOWFALL_MS;
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
    player.attackLockUntil = 0;
    player.attackCooldownUntil = 0;
    player.slowFallUntil = 0;
    player.hp = PLAYER_MAX_HP;
    player.attackGauge = 0;
    player.hovering = false;
    player.hoverStart = 0;
    player.hoverGaugeAtStart = 0;
    player.nextHoverEffectAt = 0;
    player.hitBossThisAttack = false;
    boss.headFlashUntil = 0;
    boss.leftFistFlashUntil = 0;
    boss.rightFistFlashUntil = 0;
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

    // Boss sits right in front of the background, behind the walls and
    // ground -- the platforms loop below draws on top of it, burying its
    // lower torso and letting the walls overlap its arms.
    drawBoss();

    for (const p of platforms) {
      if (p.isBossFist) continue; // drawBoss() already rendered it
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

    if (player.hovering) {
      // Pulsing cyan aura while airborne hover is active, matching the
      // gauge's fill color it's spending.
      const cx = player.x + player.width / 2;
      const cy = player.y + player.height / 2;
      const pulse = 0.5 + 0.5 * Math.sin(now / 110);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(player.width, player.height) * 0.75 + pulse * 3, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(77, 210, 255, ${0.45 + 0.3 * pulse})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.fillStyle = '#e94560';
    ctx.fillRect(player.x, player.y, player.width, player.height);

    ctx.beginPath();
    ctx.arc(player.x + player.width / 2, player.y - 7, 3, 0, Math.PI * 2);
    ctx.fillStyle = player.doubleJumpReady ? '#66e0ff' : 'rgba(255, 255, 255, 0.25)';
    ctx.fill();

    if (player.wallCling) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(player.x + 1, player.y + 1, player.width - 2, player.height - 2);
    }

    ctx.fillStyle = '#fff';
    let eyeX = player.facing === 1 ? player.x + player.width - 7 : player.x + 3;
    let eyeY = player.y + 6;
    if (keys.up) {
      eyeY = player.y + 1;
    } else if (keys.down) {
      eyeY = player.y + player.height - 7;
    }
    ctx.fillRect(eyeX, eyeY, 4, 4);

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

    drawPlayerUI();
  }

  // Giant boss: head, trapezoid torso, and two arms (upper arm -> elbow ->
  // forearm -> wrist -> fist). The right arm plays a ground-pound pattern
  // (see updateBossPattern); the left arm is still static.
  function drawBossArm(shoulderX, shoulderY, upperAngle, dir, elbowBend = BOSS_ELBOW_BEND) {
    function jointPin(r) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#1c0f26';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(shoulderX, shoulderY);
    ctx.rotate(upperAngle);

    ctx.fillStyle = '#4a2f5c';
    roundRect(0, -BOSS_UPPER_W / 2, BOSS_UPPER_LEN * dir, BOSS_UPPER_W, 15 * BOSS_SCALE);
    ctx.fill();
    ctx.strokeStyle = '#1c0f26';
    ctx.lineWidth = 3;
    roundRect(0, -BOSS_UPPER_W / 2, BOSS_UPPER_LEN * dir, BOSS_UPPER_W, 15 * BOSS_SCALE);
    ctx.stroke();
    jointPin(8 * BOSS_SCALE); // shoulder

    ctx.translate(BOSS_UPPER_LEN * dir, 0);
    ctx.rotate(elbowBend * dir);

    ctx.fillStyle = '#3a2249';
    roundRect(0, -BOSS_FORE_W / 2, BOSS_FORE_LEN * dir, BOSS_FORE_W, 12 * BOSS_SCALE);
    ctx.fill();
    ctx.strokeStyle = '#1c0f26';
    ctx.lineWidth = 3;
    roundRect(0, -BOSS_FORE_W / 2, BOSS_FORE_LEN * dir, BOSS_FORE_W, 12 * BOSS_SCALE);
    ctx.stroke();
    jointPin(7 * BOSS_SCALE); // elbow

    ctx.translate(BOSS_FORE_LEN * dir, 0);
    jointPin(7 * BOSS_SCALE); // wrist

    ctx.restore();
  }

  // Square fist -- drawn axis-aligned (not rotated with the arm) since it
  // doubles as a standable/hittable rect using the same bounding box.
  function drawBossFist(rect, now, flashUntil) {
    ctx.fillStyle = '#2c1a38';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = '#1c0f26';
    ctx.lineWidth = 3;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    if (now < flashUntil) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
  }

  function drawBoss() {
    const now = performance.now();
    const torsoY = boss.groundY - BOSS_TORSO_Y_OFFSET;
    const topL = boss.x - BOSS_TOP_W / 2;
    const topR = boss.x + BOSS_TOP_W / 2;
    const botL = boss.x - BOSS_BOTTOM_W / 2;
    const botR = boss.x + BOSS_BOTTOM_W / 2;

    drawBossArm(topR - BOSS_SHOULDER_X_INSET, torsoY + BOSS_SHOULDER_Y_OFFSET, boss.rightArmAngle, 1, boss.rightElbowBend);
    drawBossArm(topL + BOSS_SHOULDER_X_INSET, torsoY + BOSS_SHOULDER_Y_OFFSET, -BOSS_ARM_ANGLE, -1);
    drawBossFist(bossRightFist, now, boss.rightFistFlashUntil);
    drawBossFist(bossLeftFist, now, boss.leftFistFlashUntil);

    // Torso -- isosceles trapezoid, shoulders (top) wider than the waist
    ctx.beginPath();
    ctx.moveTo(topL, torsoY);
    ctx.lineTo(topR, torsoY);
    ctx.lineTo(botR, torsoY + BOSS_TORSO_H);
    ctx.lineTo(botL, torsoY + BOSS_TORSO_H);
    ctx.closePath();
    ctx.fillStyle = '#3a2249';
    ctx.fill();
    ctx.strokeStyle = '#1c0f26';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Head
    const head = bossHeadPos();
    ctx.fillStyle = '#4a2f5c';
    ctx.beginPath();
    ctx.arc(head.x, head.y, head.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1c0f26';
    ctx.lineWidth = 4;
    ctx.stroke();
    // neck joint pin
    ctx.beginPath();
    ctx.arc(head.x, head.y + head.r - 2, 4 * BOSS_SCALE, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1c0f26';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    // eyes
    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.arc(head.x - 18 * BOSS_SCALE, head.y - 4 * BOSS_SCALE, 6 * BOSS_SCALE, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(head.x + 18 * BOSS_SCALE, head.y - 4 * BOSS_SCALE, 6 * BOSS_SCALE, 0, Math.PI * 2);
    ctx.fill();
    if (now < boss.headFlashUntil) {
      ctx.beginPath();
      ctx.arc(head.x, head.y, head.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.fill();
    }
  }


  function heartPath(cx, topY, w, h) {
    ctx.beginPath();
    ctx.moveTo(cx, topY + h);
    ctx.bezierCurveTo(cx - w / 2, topY + h * 0.6, cx - w / 2, topY, cx, topY + h * 0.32);
    ctx.bezierCurveTo(cx + w / 2, topY, cx + w / 2, topY + h * 0.6, cx, topY + h);
    ctx.closePath();
  }

  // 5 hearts in half-heart units (player.hp 0-10): each heart is drawn as
  // an empty outline first, then a red fill clipped to however much of
  // that heart's half is still left, giving a half-full heart look.
  function drawHearts(x, y, size, gap) {
    for (let i = 0; i < PLAYER_MAX_HP / 2; i++) {
      const cx = x + i * (size + gap) + size / 2;
      heartPath(cx, y, size, size);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();

      const fillFrac = Math.max(0, Math.min(1, (player.hp - i * 2) / 2));
      if (fillFrac > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx - size / 2, y - 2, size * fillFrac, size + 4);
        ctx.clip();
        heartPath(cx, y, size, size);
        ctx.fillStyle = '#ff4d6d';
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // A segmented gauge (one tick every 20%) that fills as the player
  // attacks; nothing spends it yet, it's a resource for a future move.
  function drawAttackGauge(x, y, w, h) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(x, y, w, h);

    const fillW = w * (player.attackGauge / ATTACK_GAUGE_MAX);
    ctx.fillStyle = player.attackGauge >= ATTACK_GAUGE_MAX ? '#ffcc00' : '#4dd2ff';
    ctx.fillRect(x, y, fillW, h);

    for (let i = 1; i < ATTACK_GAUGE_SEGMENTS; i++) {
      const lx = x + (w * i) / ATTACK_GAUGE_SEGMENTS;
      ctx.beginPath();
      ctx.moveTo(lx, y);
      ctx.lineTo(lx, y + h);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  // Top-right HUD: 5 hearts above a 5-segment attack gauge.
  function drawPlayerUI() {
    const heartSize = 30;
    const heartGap = 8;
    const rowWidth = (PLAYER_MAX_HP / 2) * (heartSize + heartGap) - heartGap;
    const margin = 50;
    const left = WIDTH - margin - rowWidth;
    const heartsY = 16;

    drawHearts(left, heartsY, heartSize, heartGap);
    drawAttackGauge(left, heartsY + heartSize + 10, rowWidth, 18);
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
        if (isDown) tryStartHoverFromHeldZ();
        break;
      case 'ArrowDown':
        keys.down = isDown;
        e.preventDefault();
        if (isDown) tryStartHoverFromHeldZ();
        break;
      case 'KeyZ':
        if (isDown) {
          keys.jump = true;
          if (!e.repeat) doJump();
        } else {
          keys.jump = false;
          releaseJumpCharge();
          stopHover();
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
  bindHold(btnJump, doJump, () => {
    releaseJumpCharge();
    stopHover();
  });

  resetPlayer();
  loop();
})();
