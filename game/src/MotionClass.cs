// 动画分类与合成策略。
// 关键点：分类决定的不只是"动作多大"，而是**用哪种方式叠到游戏身上**。
//   Gesture（点头/摇头/笑/思考）：必须叠加式 —— 她保持待机，手只加一小段增量，绝不搬身体。
//   Prop（喝茶/吃东西/翻书/打字）：必须有绝对姿势 —— 手要真的到杯子/键盘那儿，
//        纯叠加做不到，只能在她自己的姿势上"过渡过去"，并且过渡要慢（不然是位移感）。
//   Posture（起身/躺下/伸懒腰/打哈欠）：绝对姿势 + 独占，做完必须回待机。
//   Locomotion（走/跑/离座）：绝对姿势 + 独占 + 不许改时间轴（变速会滑步）。
//   Idle：环境待机，永远走绝对混合兜底。
using System;

namespace ChillPerformer
{
    internal enum ClipClass
    {
        Gesture = 0,
        Prop = 1,
        Posture = 2,
        Locomotion = 3,
        Idle = 4,
        Unknown = 5
    }

    internal struct MotionProfile
    {
        public ClipClass Class;
        public bool Additive;      // true = 叠在游戏姿势上；false = 向绝对姿势过渡
        public bool Exclusive;     // true = 期间不接受其它 cue
        public bool SpeedWarp;     // true = 允许为塞进 cue 的 d 而变速
        public float RampMs;       // 绝对模式下"过渡过去"要多久
        public float BodyDeg;      // 身体峰值幅度预算
        public float HeadDeg;      // 头/颈峰值幅度预算
        public float BodyBurst;    // 大动作允许的超预算倍数
        public float HeadBurst;
        public float FadeMs;       // 进场/退场包络
        public float MaxSec;       // 单次占用骨骼的上限

        public static MotionProfile For(ClipClass c)
        {
            var p = new MotionProfile();
            p.Class = c;
            p.Additive = true;
            p.Exclusive = false;
            p.SpeedWarp = true;
            p.RampMs = 0f;
            p.BodyDeg = 26f;
            p.HeadDeg = 15f;
            p.BodyBurst = 3f;
            p.HeadBurst = 1.5f;
            p.FadeMs = 320f;
            p.MaxSec = 8f;
            switch (c)
            {
                case ClipClass.Gesture:
                    // 小动作叠在待机上：幅度小、增益主要给头，速度可调
                    p.Additive = true;
                    p.BodyDeg = 12f;
                    p.HeadDeg = 18f;
                    p.BodyBurst = 1.6f;
                    p.HeadBurst = 2.2f;
                    p.FadeMs = 380f;
                    p.MaxSec = 5f;
                    break;
                case ClipClass.Prop:
                    // 道具互动需要真的够到道具：绝对姿势 + 慢过渡（600ms 才不像瞬移）
                    p.Additive = false;
                    p.RampMs = 600f;
                    p.BodyDeg = 70f;
                    p.HeadDeg = 26f;
                    p.BodyBurst = 2.2f;
                    p.HeadBurst = 1.6f;
                    p.FadeMs = 420f;
                    p.MaxSec = 12f;
                    break;
                case ClipClass.Posture:
                    // 起身/躺下/伸懒腰：大范围、独占、过渡更慢，做完回待机
                    p.Additive = false;
                    p.Exclusive = true;
                    p.RampMs = 900f;
                    p.BodyDeg = 120f;
                    p.HeadDeg = 32f;
                    p.BodyBurst = 2f;
                    p.HeadBurst = 1.6f;
                    p.FadeMs = 480f;
                    p.MaxSec = 16f;
                    break;
                case ClipClass.Locomotion:
                    // 走/跑/离座：不能变速（会滑步），独占，过渡短
                    p.Additive = false;
                    p.Exclusive = true;
                    p.SpeedWarp = false;
                    p.RampMs = 300f;
                    p.BodyDeg = 140f;
                    p.HeadDeg = 32f;
                    p.BodyBurst = 1.8f;
                    p.HeadBurst = 1.4f;
                    p.FadeMs = 300f;
                    p.MaxSec = 20f;
                    break;
                case ClipClass.Idle:
                    p.Additive = false;
                    p.RampMs = 700f;
                    p.BodyDeg = 40f;
                    p.HeadDeg = 24f;
                    p.BodyBurst = 1.8f;
                    p.HeadBurst = 1.5f;
                    p.FadeMs = 500f;
                    p.MaxSec = 10f;
                    break;
                default:
                    p.Additive = false;
                    p.RampMs = 500f;
                    p.BodyDeg = 40f;
                    p.HeadDeg = 22f;
                    p.BodyBurst = 2f;
                    p.HeadBurst = 1.6f;
                    p.FadeMs = 420f;
                    p.MaxSec = 10f;
                    break;
            }
            return p;
        }
    }

    internal static class MotionRules
    {
        // 名字 → 分类：按优先级判定，先判"最不可能被别的词误伤"的类别。
        // 顺序：位移 > 姿态 > 道具 > 显式手势 > sub 小动作 > 待机 > wild 兜底。
        private static readonly string[] LocomotionKeys = { "walk", "run", "leavechair", "go", "comeback", "move", "approach" };
        private static readonly string[] PostureKeys = { "sit", "stand", "laya", "sleep", "slee", "yawn", "stretch", "plank", "dance", "lie", "wake", "banzai", "guts", "eieio", "feellarge", "wet" };
        private static readonly string[] PropKeys = { "drink", "eat", "tea", "coffee", "cup", "book", "openbook", "pen", "phone", "headphone", "pc", "report", "typing", "write", "magazine", "newspaper", "trash", "window" };
        private static readonly string[] GestureKeys = { "nod", "shake", "agree", "think", "laugh", "cry", "smile", "shy", "sad", "joy", "fun", "anger", "surprise", "presshands", "hand", "wave", "bow", "reaction", "movie", "lookplayer" };

                // token 匹配：id 用 _ 切开，token 相等才算命中；长键允许前缀（nod1 / thinking1）
        private static string[] TokensOf(string id)
        {
            string v = id ?? "";
            if (v.StartsWith("anim_")) v = v.Substring(5);
            return v.Split(new[] { '_' }, StringSplitOptions.RemoveEmptyEntries);
        }

        private static bool HasToken(string[] tokens, string key)
        {
            for (int i = 0; i < tokens.Length; i++)
            {
                if (tokens[i] == key) return true;
                if (key.Length >= 4 && tokens[i].StartsWith(key)) return true;
            }
            return false;
        }

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
            if (HasToken(TokensOf(s), "sub")) return ClipClass.Gesture;
            if (IsIdle(s)) return ClipClass.Idle;
            // wild_* 这类没被关键词命中的，当姿态动作处理（绝对过渡 + 独占，比当成叠加安全）
            if (HasToken(TokensOf(s), "wild")) return ClipClass.Posture;
            return ClipClass.Unknown;
        }

                private static bool IsIdle(string s)
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
        }

        public static string Label(ClipClass c)
        {
            switch (c)
            {
                case ClipClass.Gesture: return "gesture";
                case ClipClass.Prop: return "prop";
                case ClipClass.Posture: return "posture";
                case ClipClass.Locomotion: return "locomotion";
                case ClipClass.Idle: return "idle";
                default: return "unknown";
            }
        }

        private static bool HasAny(string s, string[] keys)
        {
            string[] tokens = TokensOf(s);
            for (int i = 0; i < keys.Length; i++) if (HasToken(tokens, keys[i])) return true;
            return false;
        }
        // 过渡时长矩阵：从她此刻正在做的类别走到目标类别要多久。
        // 手势之间极短（反应要快），进道具/姿态要长（要真的伸手、起身），
        // 从位移出来要等脚步收住 —— 这一张表就是"以当前动作为起点"的具体实现。
        public static float TransitionMs(ClipClass from, ClipClass to)
        {
            bool g0 = from == ClipClass.Gesture, g1 = to == ClipClass.Gesture;
            if (g0 && g1) return 200f;
            if (g0 && to == ClipClass.Prop) return 620f;
            if (g0 && to == ClipClass.Posture) return 900f;
            if (g0 && to == ClipClass.Locomotion) return 700f;
            if (from == ClipClass.Prop && g1) return 420f;
            if (from == ClipClass.Prop && to == ClipClass.Prop) return 380f;
            if (from == ClipClass.Prop && to == ClipClass.Posture) return 900f;
            if (from == ClipClass.Prop && to == ClipClass.Locomotion) return 800f;
            if (from == ClipClass.Posture && g1) return 520f;
            if (from == ClipClass.Posture && to == ClipClass.Prop) return 700f;
            if (from == ClipClass.Posture && to == ClipClass.Posture) return 900f;
            if (from == ClipClass.Posture && to == ClipClass.Locomotion) return 900f;
            if (from == ClipClass.Locomotion && g1) return 600f;
            if (from == ClipClass.Locomotion && to == ClipClass.Prop) return 700f;
            if (from == ClipClass.Locomotion) return 900f;
            if (g1) return 240f;
            if (to == ClipClass.Prop) return 600f;
            if (to == ClipClass.Posture) return 900f;
            if (to == ClipClass.Locomotion) return 700f;
            return 400f;
        }

    }
}