Page({
  data: {
    familyName: "云岫张氏",
    members: 126,
    relationships: 184,
    reviewedThisMonth: 23,
  },
  openTree() {
    void wx.navigateTo({ url: "/pages/family-tree/index" });
  },
  openPerson() {
    void wx.navigateTo({ url: "/pages/person-detail/index" });
  },
  openEntry() {
    void wx.navigateTo({ url: "/pages/family-entry/index" });
  },
  openReview() {
    void wx.navigateTo({ url: "/pages/review-center/index" });
  },
  switchFamily() {
    void wx.showToast({ title: "已切换为当前演示家族", icon: "none" });
  },
});
