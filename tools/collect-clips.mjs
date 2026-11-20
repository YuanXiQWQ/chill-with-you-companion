// 从游戏日志里收齐完整动作集，生成机器可用的清单：game/clips.full.json
// 只读日志，不改游戏资源。
import { readFileSync, writeFileSync } from 'node:fs'

const LOG = process.argv[2] || 'E:/SteamLibrary/steamapps/common/Chill with You Lo-Fi Story/BepInEx/LogOutput.log'
const text = readFileSync(LOG, 'utf8')

const rows = []
const re = /clipdump (\S+) (\S+) (\S+) ([\d.]+)/g
let m
while ((m = re.exec(text))) {
  rows.push({ owner: m[1], ctrl: m[2], name: m[3], seconds: Number(m[4]) })
}

// 去重（按 owner+name），并按名字前缀归档到"家族 / 段"
const uniq = new Map()
for (const r of rows) if (!uniq.has(r.owner + '/' + r.name)) uniq.set(r.owner + '/' + r.name, r)
const list = [...uniq.values()].sort((a, b) => a.name.localeCompare(b.name))

const segOf = (name) => {
  const mm = /_(start|loop|loop2|end)$/i.exec(name)
  return mm ? mm[1].toLowerCase() : 'single'
}
const familyOf = (name, scene) => {
  if (scene && name.startsWith(scene + '_')) {
    const rest = name.slice(scene.length + 1).replace(/_(start|loop|loop2|end)$/i, '')
    return scene + '_' + rest
  }
  return name.replace(/_(start|loop|loop2|end)$/i, '')
}

const anims = list.filter((r) => /^anim_/i.test(r.name))
const byFamily = new Map()
for (const r of anims) {
  const scene = (/^anim_([a-z]+)_/i.exec(r.name) || [])[1] || ''
  const fam = familyOf(r.name, scene)
  if (!byFamily.has(fam)) byFamily.set(fam, { family: fam, scene, segs: [], segSeconds: {}, owners: new Set() })
  const f = byFamily.get(fam)
  const seg = segOf(r.name)
  if (!f.segs.includes(seg)) f.segs.push(seg)
  f.segSeconds[seg] = r.seconds
  f.owners.add(r.owner)
}

const fams = [...byFamily.values()].map((f) => ({
  family: f.family,
  scene: f.scene,
  segs: f.segs.sort(),
  segSeconds: f.segSeconds,
  owners: [...f.owners]
})).sort((a, b) => a.family.localeCompare(b.family))

const shape = (f) => {
  const has = (s) => f.segs.includes(s)
  if (has('start') && (has('loop') || has('loop2')) && has('end')) return 'end+loop+start'
  if (has('start') && has('end')) return 'end+start'
  if ((has('loop') || has('loop2')) && has('end')) return 'loop+end'
  if (has('start') && (has('loop') || has('loop2'))) return 'start+loop'
  if (has('start')) return 'start'
  if (has('loop') || has('loop2')) return 'loop'
  if (has('end')) return 'end'
  return 'single'
}

const shapes = {}
for (const f of fams) shapes[shape(f)] = (shapes[shape(f)] || 0) + 1
const scenes = {}
for (const f of fams) scenes[f.scene || '-'] = (scenes[f.scene || '-'] || 0) + 1
const owners = {}
for (const r of anims) owners[r.owner] = (owners[r.owner] || 0) + 1
const ctrls = {}
for (const r of anims) ctrls[r.ctrl] = (ctrls[r.ctrl] || 0) + 1

const out = {
  generatedAt: new Date().toISOString(),
  source: 'game LogOutput.log clipdump',
  totalClips: list.length,
  animationClips: anims.length,
  nonAnimationClips: list.filter((r) => !/^anim_/i.test(r.name)).length,
  families: fams.length,
  shapes,
  scenes,
  owners,
  controllers: ctrls,
  byFamily: fams
}
writeFileSync('game/clips.full.json', JSON.stringify(out, null, 2) + '\n', 'utf8')

console.log(`  动作 clip ${anims.length} / 全部 clip ${list.length} → 家族 ${fams.length}`)
console.log('  家族形态: ' + Object.entries(shapes).map(([k, v]) => k + '=' + v).join('  '))
console.log('  场景前缀: ' + Object.entries(scenes).map(([k, v]) => (k || '-') + ':' + v).join('  '))
console.log('  归属对象: ' + Object.entries(owners).map(([k, v]) => k + ':' + v).join('  '))
console.log('  控制器: ' + Object.entries(ctrls).map(([k, v]) => k + ':' + v).slice(0, 6).join('  '))
