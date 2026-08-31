Page({
  data: {
    filters: ["全部 5", "人物 2", "关系 2", "认领 1"],
    activeFilter: "全部 5",
    selectedId: 1,
    queue: [
      {
        id: 1,
        type: "关系新增",
        title: "为张云舟添加父亲",
        author: "张云舟",
        time: "12 分钟前",
        risk: "疑似重复",
        tone: "risk",
      },
      {
        id: 2,
        type: "人物认领",
        title: "张禾申请认领本人",
        author: "张禾",
        time: "1 小时前",
        risk: "低风险",
        tone: "safe",
      },
      {
        id: 3,
        type: "资料修改",
        title: "补充林秋兰的出生地",
        author: "沈嘉宁",
        time: "昨天",
        risk: "来源完整",
        tone: "safe",
      },
    ],
  },
  selectFilter(event: WechatMiniprogram.TouchEvent) {
    this.setData({
      activeFilter: event.currentTarget.dataset.filter as string,
    });
  },
  selectItem(event: WechatMiniprogram.TouchEvent) {
    this.setData({ selectedId: Number(event.currentTarget.dataset.id) });
  },
  decide(event: WechatMiniprogram.TouchEvent) {
    const action = event.currentTarget.dataset.action as string;
    const messages: Record<string, string> = {
      approve: "批准后，这组变更将整体进入正式家谱。原型不会写入真实数据。",
      reject: "驳回会保留提交记录和理由，不改变正式家谱。",
      revise: "将退回给提交者补充来源或修改冲突项。",
    };
    wx.showModal({
      title:
        action === "approve"
          ? "确认批准"
          : action === "reject"
            ? "确认驳回"
            : "要求修改",
      content: messages[action] ?? "记录本次审核决定。",
      confirmText: action === "approve" ? "批准" : "确认",
      success: (result) => {
        if (result.confirm)
          void wx.showToast({ title: "演示决定已记录", icon: "success" });
      },
    });
  },
});
