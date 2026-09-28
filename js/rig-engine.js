// Generic keyframe-motion sampler + player, shared by the rig editor
// (index.html) and the game (game.js) so a motion authored in the editor
// plays back in the real game with no hand-transcription in between.
window.RigEngine = (() => {
  const EASINGS = {
    linear: (t) => t,
    easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
    easeInCubic: (t) => t * t * t,
    easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  };

  function ease(name, t) {
    const fn = EASINGS[name] || EASINGS.linear;
    return fn(Math.max(0, Math.min(1, t)));
  }

  function totalDuration(motion) {
    let sum = 0;
    for (let i = 1; i < motion.keyframes.length; i++) sum += motion.keyframes[i].duration || 0;
    return sum;
  }

  // Samples a motion at `elapsedMs` since it started: walks the keyframe
  // list cumulatively by duration, finds the current segment, and lerps
  // each angle key between the previous keyframe's pose and this one's
  // using that segment's easing.
  function sampleMotion(motion, elapsedMs) {
    const kfs = motion.keyframes;
    let t = Math.max(0, elapsedMs);
    let prev = kfs[0];
    for (let i = 1; i < kfs.length; i++) {
      const kf = kfs[i];
      const dur = kf.duration || 0;
      const isLast = i === kfs.length - 1;
      if (t <= dur || isLast) {
        const localT = dur > 0 ? Math.min(1, t / dur) : 1;
        const e = ease(kf.easing, localT);
        const angles = {};
        for (const key in kf.angles) {
          const from = key in prev.angles ? prev.angles[key] : kf.angles[key];
          const to = kf.angles[key];
          angles[key] = from + (to - from) * e;
        }
        return { angles, segmentIndex: i, localT, done: isLast && localT >= 1 };
      }
      t -= dur;
      prev = kf;
    }
    return { angles: { ...kfs[0].angles }, segmentIndex: 0, localT: 1, done: true };
  }

  function createMotionPlayer() {
    return { playing: false, startTime: 0, firedSegments: null };
  }

  function playMotion(state, now) {
    state.playing = true;
    state.startTime = now;
    state.firedSegments = new Set();
  }

  // Advances the player and returns the current angle map, or null when
  // not playing. Fires `onEvent(eventName)` once per segment the first
  // time that segment's easing finishes (e.g. an "impact" tag at a slam's
  // bottom), so game code can trigger a hit/effect exactly on beat.
  function updateMotionPlayer(state, motion, now, onEvent) {
    if (!state.playing) return null;
    const elapsed = now - state.startTime;
    const sample = sampleMotion(motion, elapsed);
    const kf = motion.keyframes[sample.segmentIndex];
    if (kf.event && sample.localT >= 1 && !state.firedSegments.has(sample.segmentIndex)) {
      state.firedSegments.add(sample.segmentIndex);
      if (onEvent) onEvent(kf.event);
    }
    if (sample.done) state.playing = false;
    return sample.angles;
  }

  return { EASINGS, ease, totalDuration, sampleMotion, createMotionPlayer, playMotion, updateMotionPlayer };
})();
