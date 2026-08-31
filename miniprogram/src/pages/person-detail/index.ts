Page({
  data: {
    claimed: false,
    pendingVisible: true,
  },
  claimPerson() {
    wx.showModal({
      title: "认领张云舟",
      content:
        "认领会建立你的微信账号与谱中人物的关联，提交后由家族管理员审核。",
      confirmText: "提交认领",
      success: (result) => {
        if (result.confirm) {
          this.setData({ claimed: true });
          void wx.showToast({ title: "认领申请已提交", icon: "success" });
        }
      },
    });
  },
  openEntry() {
    void wx.navigateTo({ url: "/pages/family-entry/index" });
  },
  invite() {
    void wx.showToast({ title: "已生成仅含必要信息的邀请卡", icon: "none" });
  },
  togglePending() {
    this.setData({ pendingVisible: !this.data.pendingVisible });
  },
});
