# 编辑器手动操作清单

以下是无法用代码完成、必须在 Meta Horizon Studio 里手动做的事。
分支 `fix/core-gameplay-and-ui-lifecycle` 的代码改动依赖这些。

## 状态标记
- [ ] 待办 —— 需要在编辑器里手动操作
- [x] 已完成

---

## 脚本同步
- [ ] 拉取本分支后，在 Horizon Studio 打开项目，让它重新转译改动/新增的脚本（`HexGameManager.ts`、`OccupyCombatSystem.ts`、`BoardRenderer.ts`、`OccupyLobbyScreen.ts`，以及新文件 `progression.ts`）。没有新增组件，所以不需要新挂载。
- [ ] 确认 `HexBoardRenderer` 组件（挂在 player 实体上）的 `tileTemplate` 和 `markerTemplate` 两个属性仍然有绑定。棋盘现在改成在组件启动时就预生成，如果这两个绑定为空，棋盘将完全不显示（日志：`No tileTemplate assigned - cannot spawn tiles`）。
- [ ] `progression.ts` 是普通模块（不是组件）—— 只要它存在于 scripts 文件夹里，供 `OccupyLobbyScreen` import 即可。无需挂载。

## Meta UI —— 需要验证的 XAML 绑定（`ui/OccupyLobby.xaml`）
4 个 "Upgrade" 按钮和 4 个 chest 槽已从静态 `Border` 改成绑定了 `events.onUpgradeCard1..4` / `events.onChest1..4` 的 `Button`。其中 chest 的 `TextBlock` 文字绑定（`{Binding Path=chestNText}`）**写在 Button 的 ControlTemplate 内部**。
- [ ] 验证改成模板后 chest 槽仍能显示文字（Empty / 倒计时 / "Ready!"）。如果显示空白，说明模板内的 `DataContext` 没有继承下来 —— 告诉我，我把它们改成 `Button.Content` + `ContentPresenter` 模板的写法。
- [ ] 验证点击 Upgrade / chest 按钮有响应（看 console：`Upgraded ...`、`Claimed chest ...`）。

## 验收清单（在 Studio 里跑一局）
- [ ] 在玩家格子上建兵营 → 约 5s 内开始出兵（中途建造现在生效了）。
- [ ] 建防御塔 → 会攻击附近的敌人。
- [ ] AI 会自己扩张（它的格子上出现建筑、AI 单位出现并向你推进）。
- [ ] HUD 的领地分数（`X : Y`）随占格实时变化。
- [ ] 对局只结算一次（单个结算界面）—— base 被打掉 或 计时到 0:00，不会弹两次。
- [ ] 主页/lobby 界面背后**没有** 3D 棋盘或单位 marker 透出来（首次进入前、以及打完一局回到 lobby 后，都要检查）。
- [ ] 点 "Start" 后棋盘几乎瞬间显示（没有长时间的 spawn 延迟）。
- [ ] lobby（以及对局中）没有移动摇杆 / 第一人称头像操作；输入是纯点击（tap-only）。
- [ ] 卡牌升级有效：点 Upgrade → 等级上升，金币/碎片扣减（初始 5000 金币、每卡 200 碎片，方便立刻测试）。
- [ ] 卡牌等级影响对局：比如把 Spearman 升到 Lv4，开一局，你的矛兵明显比 AI 的更肉/更强（AI 按设计固定 Lv1）。
- [ ] 箱子循环：打完一局会出现一个箱子 → 点击开始它的 10 分钟倒计时 →（10 分钟跑不完；想快速验证 "ready/claim" 路径，可临时把 `progression.ts` 里的 `CHEST_DURATION_MS` 调小）。
- [ ] Meta 是 session-only 设计 —— 金币/等级/箱子在世界 reload 后会重置（持久化已推迟）。

---

## 需要你定的事项

### B1 —— 去掉 lobby 的第一人称 UI（头像 + 移动摇杆）

**根因（已从代码 + Meta 文档确认）：**
- 对局中摇杆其实已经没了：`HexInputController` 在 `Playing` 时打开 `FocusedInteractionService.enableFocusedInteraction(...)`，而 Focused Interaction 模式会整个禁用 locomotion。
- 但在 **lobby**，Focused Interaction 是故意关闭的（开了会吞掉 "Start" 按钮的点击），且 `OccupyBoardCamera` 只在 `Playing` 时才激活。所以 lobby 退回到默认的第一/第三人称头像视角，带系统移动摇杆 + 可见头像。
- 移动摇杆是**受保护的系统控件** —— 据 Meta 论坛，TypeScript 无法完全移除它，只能通过 Focused Interaction（会挡 UI）或 **Avatar Pose Gizmo**（v214+）。`Docs/PROJECT_SUMMARY.md` 里写的 "avatar hidden (scale=0) + no joystick" 其实从未在代码里实现。

**为什么没在代码里修：** 隐藏头像 / 禁用 locomotion 需要 `meta/worlds` 桌面编辑器 SDK 的 player API，其确切名称我无法从公开文档确认、也无法本地 typecheck。不去猜、不提交可能编译不过的代码。

**已选定方案：A —— 编辑器 Player Settings（无需代码）。**

- **[ ] A. 编辑器 Player Settings（无需代码）。** 在桌面编辑器打开世界的 Player Settings 面板，把 avatar 设为隐藏/none，并禁用 locomotion / movement。文档：
  `developers.meta.com/horizon-worlds/learn/documentation/desktop-editor/settings-modifications/player-settings-modification`
  - 如果你那个编辑器版本没有 avatar 隐藏或 locomotion 的开关，告诉我，回退到方案 B 或 C。

备选方案（仅当方案 A 的开关在你的编辑器版本里不存在时）：
- **B. Avatar Pose Gizmo（v214+）** —— 用 pose gizmo 把玩家"锁座"并禁止退出，让摇杆无法移动玩家；配合隐藏头像。
- **C. 用 `meta/worlds` player API 写代码** —— 在 player 实体上加一个小组件，在玩家 spawn 时隐藏头像 + 把 locomotion 速度归零。需要你提供 `meta/worlds` 里 avatar scale/visibility 和 locomotion speed 的确切 API 名（经典 `horizon/core` 的对应写法：`player.avatarScale.set(0)`、`player.locomotionSpeed.set(0)`、`PlayerControls.disableSystemControls()`）。

**注意：** 即使头像隐藏了，除非真正禁用 locomotion（Player Settings / Focused Interaction / Pose Gizmo），摇杆控件本身可能仍然存在。在编辑器里确认主页上摇杆确实消失了。
