Page({
  data: {
    viewMode: "以我为中心",
    modes: ["以我为中心", "祖先", "后代"],
    expanded: false,
    ancestorExpanded: false,
    descendantExpanded: true,
  },
  selectMode(event: WechatMiniprogram.TouchEvent) {
    const mode = event.currentTarget.dataset.mode as string;
    this.setData({ viewMode: mode });
  },
  openPerson() {
    void wx.navigateTo({ url: "/pages/person-detail/index" });
  },
  addRelative() {
    void wx.navigateTo({ url: "/pages/family-entry/index" });
  },
  toggleExpand() {
    this.setData({ expanded: !this.data.expanded });
  },
  toggleAncestors() {
    this.setData({ ancestorExpanded: !this.data.ancestorExpanded });
  },
  toggleDescendants() {
    this.setData({ descendantExpanded: !this.data.descendantExpanded });
  },
});
