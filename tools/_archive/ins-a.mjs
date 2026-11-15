import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

const FIELDS = `        // 归还过渡的目标：演完时"游戏此刻会把她摆成什么样"，现场求值后读出
        private Quaternion[] exitRot;
        private bool exitValid;
        private Quaternion[] prevPose;`

if (!s.includes('private Quaternion[] exitRot;')) {
  if (!s.includes('        private Quaternion[] prevPose;')) throw new Error('字段锚点失配')
  s = s.replace('        private Quaternion[] prevPose;', FIELDS)
}

const HELPER = [
  '        /**',
  '         * 读出"游戏自己此刻的姿势"。',
  '         * 不能在 LateUpdate 里直接抓 bones.localRotation —— 那上面是我们上一帧写回去的值，',
  '         * 叠加路径会因此每帧自乘（实测 dev=119°）。让 Animator 当场重算一帧再读。',
  '         * 起手与归还都用它。',
  '         */',
  '        private bool CaptureGamePose(Quaternion[] dst)',
  '        {',
  '            if (heroine == null || bones == null || bones.Length == 0 || dst == null) return false;',
  '            bool was = heroine.enabled;',
  '            if (!was) heroine.enabled = true;',
  '            try { heroine.Update(0f); } catch { }',
  '            for (int i = 0; i < bones.Length && i < dst.Length; i++)',
  '            {',
  '                if (bones[i] != null) dst[i] = bones[i].localRotation;',
  '            }',
  '            if (!was) heroine.enabled = was;',
  '            return true;',
  '        }',
  '',
  '        private void StepClip(float ct)'
].join('\n')

if (!s.includes('private bool CaptureGamePose')) {
  if (!s.includes('        private void StepClip(float ct)')) throw new Error('StepClip 锚点失配')
  s = s.replace('        private void StepClip(float ct)', HELPER)
}

writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')
console.log('  A ✓ 字段与 CaptureGamePose')
