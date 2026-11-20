import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

// ── 起手：现场求值 ──
const OLD_BASE = [
  '            if (!clipActive || !baseGameValid)',
  '            {',
  '                if (baseGameRot == null || baseGameRot.Length != n)',
  '                {',
  '                    baseGameRot = new Quaternion[n];',
  '                    baseGamePos = new Vector3[n];',
  '                }',
  '                for (int i = 0; i < n; i++)',
  '                {',
  '                    baseGameRot[i] = bones[i].localRotation;',
  '                    baseGamePos[i] = bones[i].localPosition;',
  '                }',
  '                baseGameValid = true;',
  '            }'
].join('\n')

const NEW_BASE = [
  '            if (!clipActive || !baseGameValid)',
  '            {',
  '                if (baseGameRot == null || baseGameRot.Length != n)',
  '                {',
  '                    baseGameRot = new Quaternion[n];',
  '                    baseGamePos = new Vector3[n];',
  '                }',
  '                // 起手：让她此刻的样子成为插入的起点（现场求值），而不是我们缓存的旧样子',
  '                if (!CaptureGamePose(baseGameRot))',
  '                {',
  '                    for (int i = 0; i < n; i++) baseGameRot[i] = bones[i].localRotation;',
  '                }',
  '                for (int i = 0; i < n; i++) baseGamePos[i] = bones[i].localPosition;',
  '                baseGameValid = true;',
  '            }'
].join('\n')

if (s.includes(OLD_BASE)) s = s.replace(OLD_BASE, NEW_BASE)
else if (!s.includes('CaptureGamePose(baseGameRot)')) throw new Error('起手锚点失配')

writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')
console.log('  B ✓ 起手改为现场求值')
