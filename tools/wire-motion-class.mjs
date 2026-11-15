// 把 MotionClass.cs 接进演示插件：
//   1) 构建脚本加入新文件
//   2) StartClip 按分类取策略
//   3) MeasureAndPlan 用策略里的预算
//   4) StepClip 按策略选叠加式 / 绝对过渡
//   5) 状态 JSON 暴露分类与模式
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const plugin = root + 'game/src/PerformerPlugin.cs'
const build = root + 'game/src/build.ps1'
let src = readFileSync(plugin, 'utf8')
const before = src.length

const must = (cond, msg) => { if (!cond) throw new Error(msg) }

// ── build.ps1：加入 MotionClass.cs ──
let b = readFileSync(build, 'utf8')
if (!b.includes('MotionClass.cs')) {
  b = b.replace("$a += (Join-Path $Here 'GameBusy.cs')", "$a += (Join-Path $Here 'GameBusy.cs')\r\n$a += (Join-Path $Here 'MotionClass.cs')")
  writeFileSync(build, b, 'utf8')
}

// ── 字段：当前策略 ──
if (!src.includes('private MotionProfile profile')) {
  src = src.replace('        private string planFamily = "";', `        private string planFamily = "";
        // 当前 clip 的分类策略：决定叠加式还是绝对过渡、预算多少、能否变速
        private MotionProfile profile = MotionProfile.For(ClipClass.Unknown);
        private bool inAbsolute;
        private float absRampT0 = -999f;`)
}

// ── StartClip：分类 + 独占判断 ──
must(src.includes('            planFamily = StripSuffix(clipName);'), 'planFamily 赋值缺失')
src = src.replace('            planFamily = StripSuffix(clipName);', `            planFamily = StripSuffix(clipName);
            // 分类：决定这一段的合成方式（叠加 / 绝对过渡）、预算与是否独占
            ClipClass cls = MotionRules.Classify(clipName);
            profile = MotionProfile.For(cls);
            if (profile.Exclusive && clipActive && !continueFamily)
            {
                skippedRepeat++;
                if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("anim deferred: " + MotionRules.Label(cls) + " is exclusive, still performing " + (activeClip != null ? activeClip.name : "?"));
                return;
            }`)

// ── MeasureAndPlan：预算与 burst 来自策略 ──
const oldBudget = src.slice(src.indexOf('            float degBudgetBody ='), src.indexOf('            planSpeed = Mathf.Clamp(factor, 0.2f, 1f);') + '            planSpeed = Mathf.Clamp(factor, 0.2f, 1f);'.length)
must(oldBudget, '预算段缺失')
const newBudget = `            float degBudgetBody = profile.BodyDeg;
            float degBudgetHead = profile.HeadDeg;
            float spdBudgetBody = Plugin.BodySpeedBudget == null ? 320f : Mathf.Max(30f, Plugin.BodySpeedBudget.Value);
            float spdBudgetHead = Plugin.HeadSpeedBudget == null ? 160f : Mathf.Max(20f, Plugin.HeadSpeedBudget.Value);
            if (!profile.Additive)
            {
                // 绝对过渡本身就慢（ramp 600~900ms），速度账已经记在过渡上，不再另设上限
                spdBudgetBody = Mathf.Max(spdBudgetBody, 900f);
                spdBudgetHead = Mathf.Max(spdBudgetHead, 420f);
            }
            float slowMax = Plugin.MaxSlowdown == null ? 1.6f : Mathf.Clamp(Plugin.MaxSlowdown.Value, 1f, 6f);
            float gainBodyCap = Plugin.MotionWeight == null ? 1f : Mathf.Clamp(Plugin.MotionWeight.Value, 0.1f, 3f);
            float gainHeadCap = Plugin.HeadWeight == null ? 2.2f : Mathf.Clamp(Plugin.HeadWeight.Value, 0.1f, 4f);
            if (segClips[0] != null && segClips[0].name.StartsWith("anim_wild_", StringComparison.OrdinalIgnoreCase))
            {
                gainBodyCap *= 0.7f;
                gainHeadCap *= 0.7f;
            }
            // 大动作（哈欠、伸懒腰、起身）不该被当成"过头"压掉，burst 给它们更高的预算线
            float burstBody = Mathf.Max(1f, profile.BodyBurst);
            float burstHead = Mathf.Max(1f, profile.HeadBurst);
            // 增益按族定：同一条动作的 _start/_loop/_end 必须共用一个数，否则循环点会突然放大
            float peakBodyFam;
            float peakHeadFam;
            if (!familyPeakBody.TryGetValue(planFamily, out peakBodyFam)) peakBodyFam = bodyDeg;
            if (!familyPeakHead.TryGetValue(planFamily, out peakHeadFam)) peakHeadFam = headDeg;
            peakBodyFam = Mathf.Max(peakBodyFam, bodyDeg);
            peakHeadFam = Mathf.Max(peakHeadFam, headDeg);
            familyPeakBody[planFamily] = peakBodyFam;
            familyPeakHead[planFamily] = peakHeadFam;
            float limitBody = Mathf.Min(peakBodyFam, degBudgetBody * burstBody);
            float limitHead = Mathf.Min(peakHeadFam, degBudgetHead * burstHead);
            float gainBody;
            if (!familyGainBody.TryGetValue(planFamily, out gainBody))
            {
                gainBody = peakBodyFam > 0.05f ? Mathf.Clamp(limitBody / peakBodyFam, 0f, gainBodyCap) : gainBodyCap;
                familyGainBody[planFamily] = gainBody;
            }
            float gainHead;
            if (!familyGainHead.TryGetValue(planFamily, out gainHead))
            {
                gainHead = peakHeadFam > 0.05f ? Mathf.Clamp(limitHead / peakHeadFam, 0f, gainHeadCap) : gainHeadCap;
                familyGainHead[planFamily] = gainHead;
            }
            planWBody = gainBody;
            planWHead = gainHead;
            float factor = 1f;
            if (clipSpeedAllowed(profile) && bodySpd > spdBudgetBody) factor = Mathf.Min(factor, spdBudgetBody / bodySpd);
            if (clipSpeedAllowed(profile) && headSpd > spdBudgetHead) factor = Mathf.Min(factor, spdBudgetHead / headSpd);
            if (factor < 1f) factor = Mathf.Max(factor, 1f / slowMax);
            planSpeed = Mathf.Clamp(factor, 0.2f, 1f);`
src = src.replace(oldBudget, newBudget)

// 辅助函数：是否允许时间轴缩放
if (!src.includes('private static bool clipSpeedAllowed')) {
  src = src.replace('        private void MeasureAndPlan(float baseSpeed)', `        private static bool clipSpeedAllowed(MotionProfile p)
        {
            // 位移类动作不许变速：走路的步频一改就滑步
            return p.SpeedWarp;
        }

        private void MeasureAndPlan(float baseSpeed)`)
}

// ── StartClip 尾部：绝对模式记录 ramp 起点；时长上限用策略值 ──
src = src.replace('            float maxClipSec = Plugin.MaxClipSec == null ? 8f : Mathf.Clamp(Plugin.MaxClipSec.Value, 0.5f, 30f);',
  `            float maxClipSec = Mathf.Clamp(profile.MaxSec > 0f ? profile.MaxSec : 8f, 0.5f, 40f);
            inAbsolute = !profile.Additive;
            absRampT0 = Time.time;`)

// 变速策略：cue 的 d 只在允许变速时用于提速
src = src.replace(`            float want = durationMs > 0 ? durationMs / 1000f : 0f;
            if (want > 0.05f)
            {
                float need = segTotal / want;
                if (need > spd) spd = Mathf.Min(need, capSpeed);
            }`,
  `            float want = durationMs > 0 ? durationMs / 1000f : 0f;
            if (want > 0.05f && clipSpeedAllowed(profile))
            {
                float need = segTotal / want;
                if (need > spd) spd = Mathf.Min(need, capSpeed);
            }`)

// ── StepClip：按策略选合成方式 ──
must(src.includes('                Quaternion q = gameRot[i] * ScaleDelta(delta, isHead ? wHead : wBody);'), 'StepClip 合成行缺失')
src = src.replace('                Quaternion q = gameRot[i] * ScaleDelta(delta, isHead ? wHead : wBody);',
  `                Quaternion q;
                if (profile.Additive)
                {
                    // 手势类：叠在游戏姿态上，她不会位移
                    q = gameRot[i] * ScaleDelta(delta, isHead ? wHead : wBody);
                }
                else
                {
                    // 道具/姿态/位移类：必须真的到她该去的位置，所以向绝对姿势过渡，
                    // 过渡时长由分类决定（600~900ms），不是瞬间覆盖。
                    float rampW = profile.RampMs <= 1f ? 1f : Mathf.SmoothStep(0f, 1f, Mathf.Clamp01((Time.time - absRampT0) / (profile.RampMs / 1000f)));
                    q = Quaternion.Slerp(gameRot[i], tr.localRotation, Mathf.Clamp01((isHead ? wHead : wBody) * rampW));
                }`)

// ── 状态 JSON：分类与模式 ──
must(src.includes('sb.Append(",\\"motion\\":{\\"wBody\\":")'), '状态块缺失')
src = src.replace('sb.Append(",\\"motion\\":{\\"wBody\\":")',
  'sb.Append(",\\"motion\\":{\\"class\\":\\"").Append(MotionRules.Label(profile.Class))\r\n              .Append("\\",\\"mode\\":\\"").Append(profile.Additive ? "additive" : "absolute")\r\n              .Append("\\",\\"wBody\\":")')

writeFileSync(plugin, src, 'utf8')
console.log('  ✓ 分类架构已接入：' + before + ' → ' + src.length + ' 字节')
