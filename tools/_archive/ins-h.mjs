import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

// ① 配置：按层配"收尾待机"——换的是本层待机，不是随便一段 idle
if (!s.includes('IdleSwapStory')) {
  const OLD = '            IdleSwapFadeMs = Config.Bind("motion", "IdleSwapFadeMs", 300, "Cross-fade length for the idle swap, in ms.");'
  if (!s.includes(OLD)) throw new Error('cfg 锚点失配')
  const NEW = [
    OLD,
    '            // 收尾待机按层选：演完让游戏切回她"这一层本来就该有的待机"，只是换成与结束姿势最接近的那一个。',
    '            // 实测游戏自己的待机状态机会一直往下切（tea_sub_unique001_* → tea_base_loop），',
    '            // 所以持久接管 idle 不成立；能做的只是把收尾那一次切换指到更合适的待机。',
    '            IdleSwapStory = Config.Bind("motion", "IdleSwapStory", "anim_story_subbase_002_base_loop", "Closing idle for story-layer performances.");',
    '            IdleSwapBreak = Config.Bind("motion", "IdleSwapBreak", "anim_break_tea_base_loop", "Closing idle for break-layer performances.");',
    '            IdleSwapWild = Config.Bind("motion", "IdleSwapWild", "anim_wild_tired2_loop", "Closing idle for wild-layer performances.");'
  ].join('\n')
  s = s.replace(OLD, NEW)
  s = s.replace('        internal static ConfigEntry<int> IdleSwapFadeMs;',
`        internal static ConfigEntry<int> IdleSwapFadeMs;
        internal static ConfigEntry<string> IdleSwapStory;
        internal static ConfigEntry<string> IdleSwapBreak;
        internal static ConfigEntry<string> IdleSwapWild;`)
}

// ② 按层挑收尾待机
if (!s.includes('private string PickClosingIdle')) {
  const HELPER = [
    '        /**',
    '         * 按动作所在的层挑"收尾待机"。层不是猜的：clip 名自带场景前缀（story_/break_/wild_），',
    '         * 那正是游戏自己的分层。回到本层待机，才不会出现"坐着演完却切到站立待机"。',
    '         */',
    '        private string PickClosingIdle(string finished)',
    '        {',
    '            string n = finished == null ? "" : finished;',
    '            if (n.StartsWith("anim_wild_", StringComparison.Ordinal)) return Plugin.IdleSwapWild.Value;',
    '            if (n.StartsWith("anim_break_", StringComparison.Ordinal)) return Plugin.IdleSwapBreak.Value;',
    '            if (n.StartsWith("anim_story_", StringComparison.Ordinal)) return Plugin.IdleSwapStory.Value;',
    '            return Plugin.IdleSwapClip.Value;',
    '        }',
    '',
    '        private Coroutine swapProbe;'
  ].join('\n')
  s = s.replace('        private Coroutine swapProbe;', HELPER)
}

// ③ 探针改为带目标参数 + 前 1 秒密集采样（判断"我们这次切换到底成不成"）
const OLD_PROBE = '            string want = Plugin.IdleSwapClip.Value;'
if (!s.includes(OLD_PROBE)) throw new Error('探针锚点失配')
s = s.replace(OLD_PROBE, '            string want = wantOverride ?? Plugin.IdleSwapClip.Value;')
s = s.replace('        private void ProbeIdleSwap()', '        private void ProbeIdleSwap(string wantOverride)')

// 采样点：0.05/0.15/0.3/0.6/1.0/2.5/5.0 秒
const OLD_LOOP = [
  '            for (int i = 0; i < 6; i++)',
  '            {',
  '                yield return new WaitForSecondsRealtime(1.5f);'
].join('\n')
if (!s.includes(OLD_LOOP)) throw new Error('采样锚点失配')
s = s.replace(OLD_LOOP, [
  '            float[] marks = new float[] { 0.05f, 0.15f, 0.3f, 0.6f, 1.0f, 2.5f, 5.0f };',
  '            float waited = 0f;',
  '            for (int i = 0; i < marks.Length; i++)',
  '            {',
  '                yield return new WaitForSecondsRealtime(marks[i] - waited);',
  '                waited = marks[i];'
].join('\n'))
s = s.replace('Plugin.Log.LogInfo("idle swap @" + ((i + 1) * 1.5f).ToString("F1") + "s: "',
  'Plugin.Log.LogInfo("idle swap @" + marks[i].ToString("F2") + "s: "')

// ④ 收尾调用：传按层挑出来的待机
const OLD_CALL = '                        if (Plugin.IdleSwap.Value && !string.IsNullOrEmpty(Plugin.IdleSwapClip.Value)) ProbeIdleSwap();'
if (!s.includes(OLD_CALL)) throw new Error('收尾调用锚点失配')
s = s.replace(OLD_CALL, [
  '                        if (Plugin.IdleSwap.Value && activeClip != null)',
  '                        {',
  '                            string closeIdle = PickClosingIdle(activeClip.name);',
  '                            if (!string.IsNullOrEmpty(closeIdle)) ProbeIdleSwap(closeIdle);',
  '                        }'
].join('\n'))

writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')
console.log('  H ✓ 按层收尾待机 + 密集采样探针')
