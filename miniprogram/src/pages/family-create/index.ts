const DRAFT_KEY = "digital-family-tree.family-create-draft.v1";

interface Draft {
  familyName: string;
  firstPersonName: string;
}

function readDraft(): Draft {
  const value: unknown = wx.getStorageSync(DRAFT_KEY);
  if (!value || typeof value !== "object")
    return { familyName: "", firstPersonName: "" };
  const draft = value as Partial<Draft>;
  return {
    familyName: typeof draft.familyName === "string" ? draft.familyName : "",
    firstPersonName:
      typeof draft.firstPersonName === "string" ? draft.firstPersonName : "",
  };
}

Page({
  data: readDraft(),
  updateFamilyName(event: WechatMiniprogram.Input) {
    this.setData({ familyName: event.detail.value });
    wx.setStorageSync(DRAFT_KEY, this.data);
  },
  updateFirstPersonName(event: WechatMiniprogram.Input) {
    this.setData({ firstPersonName: event.detail.value });
    wx.setStorageSync(DRAFT_KEY, this.data);
  },
  continueCreation() {
    wx.setStorageSync(DRAFT_KEY, this.data);
    void wx.showToast({ title: "完整创建流程将在下一任务接入", icon: "none" });
  },
});
