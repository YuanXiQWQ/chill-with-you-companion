import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

// ① 字段：段内幅度
if (!s.includes('private float dbgAmpHead')) {
  const OLD = '        private float dbgPushW;'
  if (!s.includes(OLD)) throw new Error('字段锚点失配')
  s = s.replace(OLD, [
    OLD,
    '        // 段内幅度：相对本段第一帧采样的角差。与 plan（段内峰值）同量纲，才能比较。',
    '        // 旧的 push 量的是离待机多远，跟 plan 不是一个东西，放在一起比只会误导。',
    '        private Quaternion[] ampStart;',
    '        private bool ampStartValid;',
    '        private float dbgAmpHead;',
    '        private float dbgAmpBody;',
    '        private string dbgAmpHeadName = "";',
    '        private string dbgAmpName = "";',
    '        private float dbgAmpW;'
  ].join('\n'))
}

// ② 采样后：首帧存基线，逐帧量段内幅度
const OLD_PUSH = [
  '                if (baseGameRot != null && baseGameRot.Length == n)',
  '                {',
  '                    float push = Quaternion.Angle(baseGameRot[i], q);',
  '                    if (isHead) { if (push > dbgPushHead) { dbgPushHead = push; dbgPushHeadName = tr.name ?? ""; dbgPushW = isHead ? wHead : wBody; } }',
  '                    else if (push > dbgPushBody) { dbgPushBody = push; dbgPushName = tr.name ?? ""; dbgPushW = wBody; }',
  '                }'
].join('\n')
if (!s.includes(OLD_PUSH)) throw new Error('push 块锚点失配')
s = s.replace(OLD_PUSH, [
  '                // 段内幅度：这一段里，当前采样离本段第一帧最远多少度 —— 与 plan 同量纲。',
  '                if (ampStart != null && ampStart.Length == n)',
  '                {',
  '                    if (capAmp) ampStart[i] = tr.localRotation;',
  '                    else',
  '                    {',
  '                        float amp = Quaternion.Angle(ampStart[i], tr.localRotation);',
  '                        if (isHead) { if (amp > dbgAmpHead) { dbgAmpHead = amp; dbgAmpHeadName = tr.name ?? ""; dbgAmpW = wHead; } }',
  '                        else if (amp > dbgAmpBody) { dbgAmpBody = amp; dbgAmpName = tr.name ?? ""; dbgAmpW = wBody; }',
  '                    }',
  '                }'
].join('\n'))

// ③ StepClip 开头：基线准备
const OLD_HEAD = '            headDevDeg = 0f;'
if (!s.includes(OLD_HEAD)) throw new Error('StepClip 起点锚点失配')
s = s.replace(OLD_HEAD, [
  '            if (ampStart == null || ampStart.Length != n)',
  '            {',
  '                ampStart = new Quaternion[n];',
  '                ampStartValid = false;',
  '            }',
  '            bool capAmp = !ampStartValid;',
  '            if (capAmp) ampStartValid = true;',
  OLD_HEAD
].join('\n'))

// ④ 日志：push → amp + moved + MISS
const OLD_LOG = '                + " push=head" + dbgPushHead.ToString("F1") + "/body" + dbgPushBody.ToString("F1") + "deg"'
if (!s.includes(OLD_LOG)) throw new Error('日志锚点失配')
s = s.replace(OLD_LOG, [
  '                + " amp=head" + dbgAmpHead.ToString("F1") + "/body" + dbgAmpBody.ToString("F1") + "deg"',
  '                + " moved=head:" + ((dbgAmpHead >= Mathf.Max(1f, planHeadPeakDeg * 0.32f)) ? 1 : 0)',
  '                + "/body:" + ((dbgAmpBody >= Mathf.Max(1f, planBodyPeakDeg * 0.32f)) ? 1 : 0)',
  '                + ((planHeadPeakDeg > 2f && dbgAmpHead < 1f) || (planBodyPeakDeg > 2f && dbgAmpBody < 1f) ? " MISS" : "")'
].join('\n'))

const OLD_BONES = '                + " bones[" + dbgPushHeadName + "@w" + dbgPushW.ToString("F2") + " | " + dbgPushName + "]"'
if (!s.includes(OLD_BONES)) throw new Error('bones 锚点失配')
s = s.replace(OLD_BONES, '                + " bones[" + dbgAmpHeadName + "@w" + dbgAmpW.ToString("F2") + " | " + dbgAmpName + "] max=" + dbgAmpW.ToString("F2")')

// ⑤ 重置
s = s.replace('            dbgPushHead = 0f; dbgPushBody = 0f;',
  '            dbgPushHead = 0f; dbgPushBody = 0f;\n            dbgAmpHead = 0f; dbgAmpBody = 0f; dbgAmpHeadName = ""; dbgAmpName = ""; ampStartValid = false;')

writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')
console.log('  L ✓ push → 段内幅度 amp + moved 判据')
