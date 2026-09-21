(() => {
  'use strict';

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');

  const WIDTH = canvas.width;
  const HEIGHT = canvas.height;
  const GRAVITY = 0.6;
  const MOVE_SPEED = 4.5;
  const JUMP_FORCE = -13;
  const GROUND_Y = HEIGHT - 40;

  const keys = {
    left: false,
    right: false,
    jump: false,
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
  };

  let camera = { x: 0 };
  let score = 0;
  let gameOver = false;

  function makePlatform(x, y, w, h) {
    return { x, y, w, h };
  }

  const platforms = [
    makePlatform(0, GROUND_Y, 600, HEIGHT - GROUND_Y),
    makePlatform(680, GROUND_Y, 900, HEIGHT - GROUND_Y),
    makePlatform(760, GROUND_Y - 90, 120, 20),
    makePlatform(950, GROUND_Y - 150, 120, 20),
    makePlatform(1150, GROUND_Y - 90, 120, 20),
    makePlatform(1650, GROUND_Y, 500, HEIGHT - GROUND_Y),
    makePlatform(1780, GROUND_Y - 110, 100, 20),
    makePlatform(1950, GROUND_Y - 190, 100, 20),
    makePlatform(2250, GROUND_Y, 900, HEIGHT - GROUND_Y),
  ];

  const WORLD_END = 3100;

  const coins = [
    { x: 800, y: GROUND_Y - 130, r: 8, taken: false },
    { x: 990, y: GROUND_Y - 190, r: 8, taken: false },
    { x: 1190, y: GROUND_Y - 130, r: 8, taken: false },
    { x: 1815, y: GROUND_Y - 150, r: 8, taken: false },
    { x: 1985, y: GROUND_Y - 230, r: 8, taken: false },
    { x: 2500, y: GROUND_Y - 60, r: 8, taken: false },
  ];

  const pits = [
    { start: 600, end: 680 },
    { start: 2150, end: 2250 },
  ];

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.width > b.x && a.y < b.y + b.h && a.y + a.height > b.y;
  }

  function update() {
    if (gameOver) return;

    if (keys.left) {
      player.vx = -MOVE_SPEED;
      player.facing = -1;
    } else if (keys.right) {
      player.vx = MOVE_SPEED;
      player.facing = 1;
    } else {
      player.vx = 0;
    }

    if (keys.jump && player.onGround) {
      player.vy = JUMP_FORCE;
      player.onGround = false;
    }

    player.vy += GRAVITY;
    if (player.vy > 18) player.vy = 18;

    player.x += player.vx;
    if (player.x < 0) player.x = 0;

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

    if (player.onGround === false) {
      player.y += player.vy;
    }

    if (player.y > HEIGHT + 100) {
      resetPlayer();
    }

    for (const c of coins) {
      if (!c.taken) {
        const dx = player.x + player.width / 2 - c.x;
        const dy = player.y + player.height / 2 - c.y;
        if (Math.hypot(dx, dy) < c.r + 20) {
          c.taken = true;
          score += 10;
          scoreEl.textContent = score;
        }
      }
    }

    if (player.x > WORLD_END) {
      player.x = WORLD_END;
    }

    camera.x = Math.max(0, Math.min(player.x - WIDTH / 2, WORLD_END - WIDTH));
  }

  function resetPlayer() {
    player.x = 100;
    player.y = GROUND_Y - player.height;
    player.vx = 0;
    player.vy = 0;
  }

  function draw() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    const skyGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    skyGrad.addColorStop(0, '#87ceeb');
    skyGrad.addColorStop(1, '#c9f0ff');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.save();
    ctx.translate(-camera.x, 0);

    ctx.fillStyle = '#3d8b3d';
    for (const p of platforms) {
      ctx.fillStyle = p.h > 30 ? '#5a3d2b' : '#3d8b3d';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = '#3d8b3d';
      ctx.fillRect(p.x, p.y, p.w, 8);
    }

    ctx.fillStyle = '#ffd700';
    for (const c of coins) {
      if (!c.taken) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#b8860b';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    ctx.fillStyle = '#e94560';
    ctx.fillRect(player.x, player.y, player.width, player.height);
    ctx.fillStyle = '#fff';
    const eyeX = player.facing === 1 ? player.x + player.width - 10 : player.x + 4;
    ctx.fillRect(eyeX, player.y + 8, 6, 6);

    ctx.restore();

    if (player.x >= WORLD_END - 5) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, HEIGHT / 2 - 40, WIDTH, 80);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('CLEAR! SCORE: ' + score, WIDTH / 2, HEIGHT / 2 + 10);
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
      case 'Space':
        keys.jump = isDown;
        if (isDown) e.preventDefault();
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
  bindHold(btnJump, () => (keys.jump = true), () => (keys.jump = false));

  resetPlayer();
  loop();
})();
