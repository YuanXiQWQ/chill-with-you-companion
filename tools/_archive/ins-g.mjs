import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

// ① 配置：待机替换（先默认关，探针验证过再开）
if (!s.includes('IdleSwapClip')) {
  const OLD = '            ReleaseMs = Config.Bind("motion", "ReleaseMs", 300, "Blend back to the game pose over this many ms after the clip ends.");'
  if (!s.includes(OLD)) throw new Error('cfg 锚点失配')
  const NEW = [
    OLD,
    '            IdleSwap = Config.Bind("motion", "IdleSwap", false, "On clip end, cross-fade the game animator to IdleSwapClip instead of blending back to a stale pose: the game keeps owning the skeleton, we just stop writing.");',
    '            IdleSwapClip = Config.Bind("motion", "IdleSwapClip", "anim_story_subbase_002_base_loop", "Clip/state the game animator is cross-faded to when a performance ends.");',
    '            IdleSwapFadeMs = Config.Bind("motion", "IdleSwapFadeMs", 300, "Cross-fade length for the idle swap, in ms.");'
  ].join('\n')
  s = s.replace(OLD, NEW)
  s = s.replace('        internal static ConfigEntry<int> ReleaseMs;',
`        internal static ConfigEntry<int> ReleaseMs;
        internal static ConfigEntry<bool> IdleSwap;
        internal static ConfigEntry<string> IdleSwapClip;
        internal static ConfigEntry<int> IdleSwapFadeMs;`)
}

// ② 探针：切过去之后，游戏是否一直保持这个状态
if (!s.includes('private void ProbeIdleSwap')) {
  const HELPER = [
    '        private Coroutine swapProbe;',
    '        /**',
    '         * 回归的新做法：不去"校准"游戏此刻的姿势，而是直接把她正在跑的待机改成另一段 idle，',
    '         * 然后彻底放手 —— 骨架归游戏，交接差按构造为 0。',
    '         * 唯一要验的是：游戏的状态机不会下一帧就把待机切回去。这个探针就是读它。',
    '         */',
    '        private void ProbeIdleSwap()',
    '        {',
    '            if (swapProbe != null) StopCoroutine(swapProbe);',
    '            swapProbe = StartCoroutine(ProbeIdleSwapCo());',
    '        }',
    '',
    '        private System.Collections.IEnumerator ProbeIdleSwapCo()',
    '        {',
    '            string want = Plugin.IdleSwapClip.Value;',
    '            if (heroine == null || string.IsNullOrEmpty(want)) yield break;',
    '            float fade = Mathf.Max(0f, Plugin.IdleSwapFadeMs.Value) / 1000f;',
    '            bool before = heroine.enabled;',
    '            if (!before) heroine.enabled = true;',
    '            try { heroine.CrossFadeInFixedTime(want, fade); } catch (Exception e) { Plugin.Log.LogWarning("idle swap failed: " + e.Message); }',
    '            Plugin.Log.LogInfo("idle swap: -> " + want + " fade=" + (fade * 1000f).ToString("F0") + "ms");',
    '            for (int i = 0; i < 6; i++)',
    '            {',
    '                yield return new WaitForSecondsRealtime(1.5f);',
    '                var st = heroine.GetCurrentAnimatorStateInfo(0);',
    '                string playing = "?";',
    '                var infos = heroine.GetCurrentAnimatorClipInfo(0);',
    '                if (infos != null && infos.Length > 0 && infos[0].clip != null) playing = infos[0].clip.name;',
    '                Plugin.Log.LogInfo("idle swap @" + ((i + 1) * 1.5f).ToString("F1") + "s: state=" + st.shortNameHash + " normalized=" + st.normalizedTime.ToString("F2") + " clip=" + playing + " want=" + want + " held=" + (playing == want));',
    '            }',
    '        }',
    '',
    '        private void StepClip(float ct)'
  ].join('\n')
  if (!s.includes('        private void StepClip(float ct)')) throw new Error('StepClip 锚点失配')
  s = s.replace('        private void StepClip(float ct)', HELPER)
}

// ③ 收尾处：开着 IdleSwap 就切待机并放手（不写 exitRot，避免踩掉游戏自己的淡入）
const OLD_HAND = '                        if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("handoff dev="'
if (!s.includes(OLD_HAND)) throw new Error('交接日志锚点失配')
const NEW_HAND = [
  '                        // 回归：直接改她正在跑的待机，然后放手。不回写姿势 —— 那会踩掉游戏自己的淡入。',
  '                        if (Plugin.IdleSwap.Value && !string.IsNullOrEmpty(Plugin.IdleSwapClip.Value)) ProbeIdleSwap();',
  OLD_HAND
].join('\n')
s = s.replace(OLD_HAND, NEW_HAND)

writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')
console.log('  G ✓ 待机替换 + 探针')
