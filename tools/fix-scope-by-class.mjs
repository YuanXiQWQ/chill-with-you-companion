import { readFileSync, writeFileSync } from 'node:fs'
// ① 游戏端：upper 的语义从"只让头动"改成"只叠加、不搬身体"。
//    原来硬锁非头骨 → 手臂动作全被吞掉，喝水的抬手根本演不出来。
{
  const p = 'game/src/PerformerPlugin.cs'
  let s = readFileSync(p, 'utf8')
  const old = `                // 专注/番茄钟：只让头和颈动，身体保持游戏自己的姿态
                if (upperOnly && !isHead)
                {
                    tr.localRotation = gameRot[i];
                    tr.localPosition = gamePos[i];
                    continue;
                }`
  if (!s.includes(old)) throw new Error('upperOnly 硬锁锚点失配')
  s = s.replace(old, `                // 说明：这里不再"只放行头骨"。upper 的正确语义是"只叠加、不搬身体"，
                // 由下方 useAdditive 实现 —— 硬锁非头骨会把抬手/前倾这些手臂动作一起吞掉，
                // 喝水的动作就退化成"歪一下头"（实测只剩 3~10°）。`)
  writeFileSync(p, s, 'utf8')
  console.log('  ✓ 去掉只放行头骨的硬锁')
}

// ② 侧车：动作范围按类别定，不按名字猜
{
  const p = 'brain.mjs'
  let s = readFileSync(p, 'utf8')
  const old = `      const fullBody = anims.some((c) => /(?:^|_)base(?:_|$)/.test(String(c.id || '')) || /^anim_wild_/.test(String(c.id || '')))
      if (!fullBody) return 'upper'`
  if (!s.includes(old)) throw new Error('scopeFor 锚点失配')
  const neu = `      // 范围跟着**类别**走，不跟着名字猜：道具/姿态/位移必须能搬身体，
      // 手势只叠加。原来按 \`_base\`/\`wild_\` 名字判断，于是"喝水"被判成 upper，
      // 身体锁住，抬手演不出来，只剩脖子转 3~10°。
      const needBody = anims.some((c) => {
        const k = classifyClip(String(c.id || ''))
        return k === 'prop' || k === 'posture' || k === 'locomotion'
      })
      if (needBody) return 'full'`
  s = s.replace(old, neu)
  writeFileSync(p, s, 'utf8')
  console.log('  ✓ scopeFor 改为按类别判定')
}
