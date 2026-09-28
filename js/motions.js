// Shared motion-authoring data: one entry per character, each with the
// joints the rig editor (index.html) can animate and a set of named
// motions built from a short sequence of keyframe poses. game.js plays
// these motions back through js/rig-engine.js's sampler exactly as
// authored here -- no hand-transcribed angle constants in the game code.
//
// A keyframe's `angles` gives the pose to reach BY THE END of that
// keyframe's segment; `duration`/`easing` describe the transition INTO it
// (so the first keyframe, the starting pose, has neither). An optional
// `event` tag fires once, the moment that segment finishes easing in, so
// game code can trigger a hit/effect exactly on beat (see bossSlamImpact
// in game.js).
window.CHARACTER_RIGS = {
  boss: {
    joints: {
      torso: { label: '몸통 회전', rest: 0, range: [-1.6, 1.6] },
      rightShoulder: { label: '오른쪽 어깨', rest: 0.53, range: [-3.2, 3.2] },
      rightElbow: { label: '오른쪽 팔꿈치', rest: 0.45, range: [-3.2, 3.2] },
      // Same rest values as the right side -- dir=-1 in bossFistCenter/
      // drawArm mirrors the rotation automatically, so no separate sign is
      // needed here.
      leftShoulder: { label: '왼쪽 어깨', rest: 0.53, range: [-3.2, 3.2] },
      leftElbow: { label: '왼쪽 팔꿈치', rest: 0.45, range: [-3.2, 3.2] },
    },
    motions: {
      groundPound: {
        cooldownMs: 1700,
        keyframes: [
          {
            label: '준비 자세',
            angles: { torso: 0, rightShoulder: 0.53, rightElbow: 0.45 },
          },
          {
            label: '감아올리기',
            duration: 650,
            easing: 'easeOutCubic',
            angles: { torso: -0.12, rightShoulder: -1.6, rightElbow: 2.6 },
          },
          {
            label: '내리찍기',
            duration: 180,
            easing: 'easeInCubic',
            angles: { torso: 0.09, rightShoulder: 1.1, rightElbow: 0.3 },
            event: 'impact',
          },
          {
            label: '복귀',
            duration: 450,
            easing: 'easeOutCubic',
            angles: { torso: 0, rightShoulder: 0.53, rightElbow: 0.45 },
          },
        ],
      },
    },
  },
};
