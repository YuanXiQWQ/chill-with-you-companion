import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/MotionClass.cs'
let s = readFileSync(p, 'utf8')

const start = s.indexOf('private static bool IsIdle(string s)')
if (start < 0) throw new Error('IsIdle 未找到')
const open = s.indexOf('{', start)
let depth = 0, end = -1
for (let i = open; i < s.length; i += 1) {
  if (s[i] === '{') depth += 1
  else if (s[i] === '}') { depth -= 1; if (depth === 0) { end = i + 1; break } }
}
// base_loop / base_start / base_end 在 token 里是 base + loop/start/end，所以按组合判断
const body = `        private static bool IsIdle(string s)
        {
            string[] tk = TokensOf(s);
            for (int i = 0; i < tk.Length; i++)
            {
                if (tk[i] == "idle" || tk[i] == "breath") return true;
                if (tk[i] == "base" && i + 1 < tk.Length)
                {
                    string next = tk[i + 1];
                    if (next == "loop" || next == "start" || next == "end") return true;
                }
            }
            return false;
        }`
s = s.slice(0, start) + body + s.slice(end)
writeFileSync(p, s, 'utf8')
console.log('  ✓ IsIdle 改为 token 判断')

// 编译验证
const { execSync } = await import('node:child_process')
process.env.CHILL_GAME_DIR = 'E:\\SteamLibrary\\steamapps\\common\\Chill with You Lo-Fi Story'
try {
  const out = execSync('powershell -NoProfile -ExecutionPolicy Bypass -File game/src/build.ps1', { encoding: 'utf8', env: process.env })
  console.log('  ' + out.trim().split('\n').filter((l) => /error CS|^OK /.test(l)).join('\n').trim())
} catch (e) {
  console.log('  build 失败:\n' + String(e.stdout || e.message).split('\n').filter((l) => /error CS/.test(l)).slice(0, 6).join('\n'))
}
