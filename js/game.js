(() => {
  'use strict';

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  const WIDTH = canvas.width;
  const HEIGHT = canvas.height;
  const GRAVITY = 0.6;
  const MOVE_SPEED = 4.5;
  const JUMP_FORCE_NORMAL = -13;
  const JUMP_FORCE_MIN = -8;
  const JUMP_FORCE_MAX = -17;
  const JUMP_CHARGE_MS = 700;
  const WALL_JUMP_VX = 6;
  const WALL_JUMP_LOCK_MS = 180;
  const DOUBLE_JUMP_FORCE = -12;
  const EFFECT_DURATION_MS = 350;
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
  };

  let effects = [];

  function spawnEffect(x, y) {
    effects.push({ x, y, start: performance.now() });
  }

  function refreshDoubleJump() {
    player.doubleJumpReady = true;
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

  function launchFromWall(vy) {
    const dir = -player.touchWall;
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

  function doJump() {
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
    // refreshDoubleJump() — called on landing, wall contact, or (future)
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
      launchFromWall(vy);
    } else {
      player.vy = vy;
      player.onGround = false;
    }
    player.charging = false;
    player.jumpCharge = 0;
  }

  function update() {
    const wallJumpLocked = performance.now() < player.wallJumpLockUntil;

    if (!wallJumpLocked) {
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

    player.vy += GRAVITY;
    if (player.vy > 18) player.vy = 18;

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
      refreshDoubleJump();
    }

    if (player.charging && !player.onGround && !player.wallCling) {
      player.charging = false;
      player.jumpCharge = 0;
    }

    const now = performance.now();
    effects = effects.filter((e) => now - e.start < EFFECT_DURATION_MS);
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
    effects = [];
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
    for (const e of effects) {
      const t = (now - e.start) / EFFECT_DURATION_MS;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 6 + t * 20, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${1 - t})`;
      ctx.lineWidth = 2;
      ctx.stroke();
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
