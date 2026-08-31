Page({
  data: {
    roles: ["父亲", "母亲", "伴侣", "儿子", "女儿"],
    selectedRole: "父亲",
    unknown: false,
    name: "",
    birthYear: "",
    source: "亲属口述",
    note: "",
  },
  selectRole(event: WechatMiniprogram.TouchEvent) {
    this.setData({ selectedRole: event.currentTarget.dataset.role as string });
  },
  toggleUnknown() {
    this.setData({ unknown: !this.data.unknown, name: "" });
  },
  setName(event: WechatMiniprogram.Input) {
    this.setData({ name: event.detail.value });
  },
  setBirthYear(event: WechatMiniprogram.Input) {
    this.setData({ birthYear: event.detail.value });
  },
  setSource(event: WechatMiniprogram.PickerChange) {
    const sources = ["本人确认", "亲属口述", "旧谱记载", "其他"];
    this.setData({ source: sources[Number(event.detail.value)] ?? "亲属口述" });
  },
  setNote(event: WechatMiniprogram.Input) {
    this.setData({ note: event.detail.value });
  },
  saveDraft() {
    void wx.showToast({ title: "草稿已保存在本机", icon: "success" });
  },
  submit() {
    if (!this.data.unknown && !this.data.name.trim()) {
      void wx.showToast({ title: "请填写姓名或选择姓名待考", icon: "none" });
      return;
    }
    wx.showModal({
      title: "提交审核？",
      content: "提交后将作为候选资料进入审核，审核通过前不会改变正式家谱。",
      confirmText: "确认提交",
      success: (result) => {
        if (result.confirm) {
          void wx.showToast({ title: "已提交审核", icon: "success" });
          setTimeout(
            () => void wx.navigateTo({ url: "/pages/review-center/index" }),
            600,
          );
        }
      },
    });
  },
});
