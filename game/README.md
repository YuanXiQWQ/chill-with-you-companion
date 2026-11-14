# ChillPerformer

## 场景时间：官方已有，本插件只上报

### 结论先行

游戏自带「自动切换」功能，实现完整且正在运行。**本插件不负责切窗户**，
只把"窗外现在是什么"报给 `chill-brain`，让聪音的台词和画面一致。

### 官方完整链路（运行时实测）

```
EnvironmentUI : UI_FacilityEnviroment
  _autoTimeWindowViewChanger = AutoTimeWindowViewChanger (MonoBehaviour)
    : IAutoTimeWindowViewChanger
    -- methods --
    ApplyTimeOfDayFromCurrentTime     ← 按当前时间应用时段
    SaveAutoTimeWindowChangeData      ← 存进存档
    RestoreWindowViewFromSaveData
    ActivateSettingButton / ActivateUI
    -- fields --
    Button          _autoSwitchButton             = AutoButton
    InteractableUI  _autoSwitchButtonInteractableUI = AutoButton
    Button          _settingOpenButton            = AutoSettingButton
    CanvasGroup     _settingOpenButtonCanvasGroup = AutoSettingButton
    RectTransform   _timButtonUIParent            = WeatherChangeButtons
    AutoTimeWindowView _autoTimeWindowView        = AutoTimeChanger
    DateService     _dateService                  = DateService
    WindowViewService _windowViewService          = WindowView
```

玩家看到的就是那个 **AutoButton**。开关状态存在存档的 `AutoTimeWindowChangeData`
里（Easy Save 3 二进制，路径 `%USERPROFILE%\AppData\LocalLow\nestopi\Chill With You\SaveData\Release\v2\<steamid>\`）。

切换本身是 `WindowViewService.ChangeWeatherAndTime(WindowViewType)`，
把 `_day` / `_sunset` / `_night` 等 29 个 GameObject 里的一个 `SetActive(true)`，
其余关掉——所以观感是硬切。`WindowViewType` 里 `Day = 11`、`Sunset = 12`、
`Night = 13`、`Cloudy = 14`。

### 本插件保留的部分

心跳里上报窗外状态：

```json
{ "scene": "RoomScene", "windowView": "Day" }
```

取值优先读游戏自己维护的 `WindowViewService.CurrentTimeOfDayType`（真实状态，
包括玩家手动切换的结果）；读不到才按钟点猜一个，再读不到就留空。

`chill-brain` 侧：

- `game.snapshot().windowView` 拿得到（`lib/game.mjs` 的 snapshot 是整个心跳对象原样存）
- `runTurn` 里读出来传给 `buildMessages({ ..., windowView })`
- `describeState(state, now, windowView)` 拼进「当前处境」

效果：

```
今天是 11 月 14 日周六，下午 14:15。午饭后容易犯困，撑一撑就过去了。（窗外是白天。）
```

映射：Day→白天 / Sunset→正黄昏 / Night→已经黑了 / Cloudy→阴天。传空串就不提。

### 已删除的重复实现

确认官方功能可用后删掉了这些（避免两边抢着切窗户）：

| 删掉的 | 原来干什么 |
| --- | --- |
| `TickSystemTime` | 每 10 秒按本地时间切窗户 |
| `ApplySystemTimeToWindow` | Boot 时切一次 |
| `ApplyWindowView` | 反射调 `ChangeWeatherAndTime` |
| `CurrentWindowViewName` | 硬编码 06:00/16:30/19:00 三段 |
| `lastAppliedByUs` | 玩家手动切换时的让路标记 |
| F5 / F6 / F7 热键 | 手动切换与六连自检 |
| `trigger-cycle.txt` | 外部驱动切换测试 |

### 剩余热键

| 键 | 作用 |
| --- | --- |
| F8 | 重跑环境探针，写 `BepInEx/chill-timeofday.txt` |
| F9 | verbose dump（原有） |
| F10 | 截图 `shot.png` |

诊断触发器：往 `BepInEx/trigger-autotime.txt` 写任意内容，1 秒内重新核查官方
自动切换的接线并写 `BepInEx/chill-autotime.txt`。

