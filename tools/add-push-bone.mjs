// 差在哪里必须点名：记录"推离最大的那根骨"名字、是否被判为头、当帧权重。
import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8')

if (!s.includes('dbgPushName')) {
  s = s.replace('        private float dbgPushBody;',
    `        private float dbgPushBody;
        private string dbgPushName = "";
        private string dbgPushHeadName = "";
        private float dbgPushW;`)
}

const old = `                if (baseGameRot != null && baseGameRot.Length == n)
                {
                    float push = Quaternion.Angle(baseGameRot[i], q);
                    if (isHead) dbgPushHead = Mathf.Max(dbgPushHead, push);
                    else dbgPushBody = Mathf.Max(dbgPushBody, push);
                }`
if (!s.includes(old)) throw new Error('推离块锚点失配')
const neu = `                if (baseGameRot != null && baseGameRot.Length == n)
                {
                    float push = Quaternion.Angle(baseGameRot[i], q);
                    if (isHead) { if (push > dbgPushHead) { dbgPushHead = push; dbgPushHeadName = tr.name ?? ""; dbgPushW = isHead ? wHead : wBody; } }
                    else if (push > dbgPushBody) { dbgPushBody = push; dbgPushName = tr.name ?? ""; dbgPushW = wBody; }
                }`
s = s.replace(old, neu)

s = s.replace(`                + " plan=head" + planHeadPeakDeg.ToString("F1") + "/body" + planBodyPeakDeg.ToString("F1") + "deg"`,
  `                + " plan=head" + planHeadPeakDeg.ToString("F1") + "/body" + planBodyPeakDeg.ToString("F1") + "deg"
                + " bones[" + dbgPushHeadName + "@w" + dbgPushW.ToString("F2") + " | " + dbgPushName + "]"
                + " ramp=" + (profile.RampMs).ToString("F0") + "ms abs=" + inAbsolute + " upperOnly=" + upperOnly`)
writeFileSync(p, s, 'utf8')
console.log('  ✓ 记录推离最大骨的名称/权重/模式')
