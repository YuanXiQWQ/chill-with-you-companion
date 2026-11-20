import { readFileSync, writeFileSync } from 'node:fs'
const must = (c, m) => { if (!c) throw new Error(m) }

// ── core.js：类别与内容一致性规则 ──
{
  const p = 'lib/core.js'
  let s = readFileSync(p, 'utf8')
  if (s.includes('动作先分类')) { console.log('  · core.js 已有类别规则'); }
  else {
    const oldLine = "    '按这句话在做什么选动作，不要只按心情套：',"
    must(s.includes(oldLine), 'core.js 锚点未找到')
    const add = [
      "    '动作先分类，再选：g=手势（反应类：点头/摇头/思考/笑/害羞/垂肩） p=道具（喝/吃/写/敲键盘/翻书/看电脑） P=姿态（起身/躺下/伸懒腰/打哈欠） l=位移（走/离座/过去） i=待机循环。',",
      "    '类别必须和这句话的内容一致，这是硬要求：',",
      "    '  说到正在喝/吃/写/敲/看书/看电脑 → 只能选 p；说到累/困/伸懒腰/站起来 → 只能选 P；',",
      "    '  说到要走/过去/离开椅子 → 只能选 l；其余反应（认同、思考、害羞、笑、难过）→ 选 g。',",
      "    '拿不准就用 g。用 p 或 P 装样子（没在喝却说在喝、没起身却躺下）比只点头更假。',",
      "    'i 类只在真的要「保持某个状态一会儿」时用，不拿来当反应。',",
      oldLine,
    ].join('\n')
    s = s.replace(oldLine, add)
    writeFileSync(p, s, 'utf8')
    console.log('  ✓ core.js：加入类别规则')
  }
}

// ── 游戏端：backlog 按年龄丢弃 ──
{
  const p = 'game/src/PerformerPlugin.cs'
  let s = readFileSync(p, 'utf8')
  if (s.includes('bootSkipAtMs')) { console.log('  · 插件已有年龄门槛'); }
  else {
    const oldBlock = `                      // 开机自检：大脑里可能还留着上次会话的条目，这里只对齐游标，不重播
                      if (!bootSynced)
                      {
                          bootSynced = true;
                          if (headSeq > 0)
                          {
                              Plugin.Log.LogInfo("pull: startup sync, skip backlog up to seq=" + headSeq);
                              feedSeq = headSeq;
                              continue;
                          }
                      }`
    must(s.includes(oldBlock), '插件旧块不一致')
    s = s.replace(oldBlock, `                      // 开机自检：大脑里可能留着上次会话的旧条目，也可能有刚推来的指令。
                      // 一律丢弃会把"刚推的那条"一起吞掉（测试时要重推两三次就是这么来的），
                      // 所以只按年龄丢：超过 BacklogTtlMs 的算旧账，新的照演。
                      if (!bootSynced)
                      {
                          bootSynced = true;
                          int ttlMs = Plugin.BacklogTtlMs == null ? 20000 : Mathf.Clamp(Plugin.BacklogTtlMs.Value, 0, 600000);
                          bootSkipAtMs = NowUnixMs() - ttlMs;
                          if (headSeq > 0) Plugin.Log.LogInfo("pull: startup sync, drop backlog older than " + ttlMs + "ms (seq=" + headSeq + ", local=" + feedSeq + ")");
                      }`)
    s = s.replace('        private bool bootSynced;', `        private bool bootSynced;
        // 首次拉取的年龄门槛：比它旧的条目算上次会话旧账，不重播；新的照演
        private long bootSkipAtMs;`)
    s = s.replace('        private void StepClip(float ct)', `        private static long NowUnixMs()
        {
            return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }

        private void StepClip(float ct)`)
    const loopAnchor = `                          var d = JsonLite.AsDict(items[i]);
                          if (d == null) continue;
`
    must(s.includes(loopAnchor), '条目循环锚点未找到')
    s = s.replace(loopAnchor, `                          var d = JsonLite.AsDict(items[i]);
                          if (d == null) continue;
                          if (bootSkipAtMs > 0)
                          {
                              long atMs = JsonLite.Int(JsonLite.Get(d, "at"));
                              if (atMs > 0 && atMs < bootSkipAtMs)
                              {
                                  if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("pull: drop stale cue at=" + atMs);
                                  continue;
                              }
                          }
`)
    s = s.replace('        internal static ConfigEntry<float> SpeedCap;', `        internal static ConfigEntry<int> BacklogTtlMs;
        internal static ConfigEntry<float> SpeedCap;`)
    s = s.replace('            SpeedCap = Config.Bind("motion", "SpeedCap"', `            BacklogTtlMs = Config.Bind("interop", "BacklogTtlMs", 20000, "On the first pull after startup, cues older than this many ms are last session's leftovers and get dropped; newer ones still play, so a push made just before startup is not swallowed.");
            SpeedCap = Config.Bind("motion", "SpeedCap"`)
    writeFileSync(p, s, 'utf8')
    console.log('  ✓ PerformerPlugin.cs：backlog 按年龄丢弃')
  }
}
