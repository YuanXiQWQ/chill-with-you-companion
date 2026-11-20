// 分类规则修正：按优先级判定，避免 "subbase001" 这类名字把情绪动作误判成待机。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const file = root + 'game/src/MotionClass.cs'
let src = readFileSync(file, 'utf8')

const start = src.indexOf('        // 名字 → 分类。')
const end = src.indexOf('        public static string Label(ClipClass c)')
if (start < 0 || end < 0) throw new Error('分类段定位失败')

const block = `        // 名字 → 分类：按优先级判定，先判"最不可能被别的词误伤"的类别。
        // 顺序：位移 > 姿态 > 道具 > 显式手势 > sub 小动作 > 待机 > wild 兜底。
        private static readonly string[] LocomotionKeys = { "walk", "run", "leavechair", "go", "comeback", "move", "approach" };
        private static readonly string[] PostureKeys = { "sit", "stand", "laya", "sleep", "slee", "yawn", "stretch", "plank", "dance", "lie", "wake", "banzai", "guts", "eieio", "feellarge", "wet" };
        private static readonly string[] PropKeys = { "drink", "eat", "tea", "coffee", "cup", "book", "openbook", "pen", "phone", "headphone", "pc", "report", "typing", "write", "magazine", "newspaper", "trash", "window" };
        private static readonly string[] GestureKeys = { "nod", "shake", "agree", "think", "laugh", "cry", "smile", "shy", "sad", "joy", "fun", "anger", "surprise", "presshands", "hand", "wave", "bow", "reaction", "movie", "lookplayer" };

        public static ClipClass Classify(string clipName)
        {
            if (string.IsNullOrEmpty(clipName)) return ClipClass.Unknown;
            string s = clipName.ToLowerInvariant();
            // _start / _loop / _end 是同一族的三个阶段，不影响分类
            if (HasAny(s, LocomotionKeys)) return ClipClass.Locomotion;
            if (HasAny(s, PostureKeys)) return ClipClass.Posture;
            if (HasAny(s, PropKeys)) return ClipClass.Prop;
            if (HasAny(s, GestureKeys)) return ClipClass.Gesture;
            // sub 段 = 叠在待机上的小动作（story_subbase001_sub_joy 这种名字里带 base，
            // 但它是情绪动作，不是待机；所以 sub 一定要在 idle 之前判）
            if (s.IndexOf("_sub", StringComparison.Ordinal) >= 0) return ClipClass.Gesture;
            if (IsIdle(s)) return ClipClass.Idle;
            // wild_* 这类没被关键词命中的，当姿态动作处理（绝对过渡 + 独占，比当成叠加安全）
            if (s.IndexOf("wild_", StringComparison.Ordinal) >= 0) return ClipClass.Posture;
            return ClipClass.Unknown;
        }

        private static bool IsIdle(string s)
        {
            if (s.IndexOf("idle", StringComparison.Ordinal) >= 0) return true;
            if (s.IndexOf("breath", StringComparison.Ordinal) >= 0) return true;
            if (s.IndexOf("base_loop", StringComparison.Ordinal) >= 0) return true;
            if (s.IndexOf("base_start", StringComparison.Ordinal) >= 0) return true;
            if (s.IndexOf("base_end", StringComparison.Ordinal) >= 0) return true;
            if (s.EndsWith("_base", StringComparison.Ordinal)) return true;
            return false;
        }

`
src = src.slice(0, start) + block + src.slice(end)
writeFileSync(file, src, 'utf8')
console.log('  ✓ 分类规则已重排')
