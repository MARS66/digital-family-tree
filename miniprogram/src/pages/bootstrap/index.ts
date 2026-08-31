import {
  loginWithWechat,
  restoreSession,
  SessionError,
  type Session,
} from "../../services/session.js";

const INVITE_DRAFT_KEY = "digital-family-tree.invite-draft.v1";

function enterSession(session: Session): void {
  const family = session.families[0];
  if (!family) return;
  wx.setStorageSync("digital-family-tree.active-family-id", family.familyId);
  void wx.reLaunch({ url: "/pages/family-home/index" });
}

Page({
  data: {
    viewState: "restoring",
    privacyAccepted: false,
    displayName: "",
    inviteCode: "",
    errorMessage: "",
    traceId: "",
  },
  onLoad() {
    const draft: unknown = wx.getStorageSync(INVITE_DRAFT_KEY);
    if (typeof draft === "string") this.setData({ inviteCode: draft });
    void this.restore();
  },
  async restore() {
    this.setData({ viewState: "restoring", errorMessage: "", traceId: "" });
    const session = await restoreSession();
    if (!session) {
      this.setData({ viewState: "login" });
      return;
    }
    if (session.families.length > 0) {
      enterSession(session);
      return;
    }
    this.setData({
      viewState: "empty",
      displayName: session.user.displayName ?? "新成员",
    });
  },
  togglePrivacy() {
    this.setData({ privacyAccepted: !this.data.privacyAccepted });
  },
  async login() {
    if (!this.data.privacyAccepted) {
      void wx.showToast({ title: "请先阅读并同意隐私说明", icon: "none" });
      return;
    }
    this.setData({ viewState: "busy", errorMessage: "", traceId: "" });
    try {
      const session = await loginWithWechat();
      if (session.families.length > 0) {
        enterSession(session);
        return;
      }
      this.setData({
        viewState: "empty",
        displayName: session.user.displayName ?? "新成员",
      });
    } catch (error) {
      const known = error instanceof SessionError ? error : undefined;
      this.setData({
        viewState: "error",
        errorMessage: known?.message ?? "登录没有完成，请重试",
        traceId: known?.traceId ?? "",
      });
    }
  },
  retryLogin() {
    void this.login();
  },
  createFamily() {
    void wx.navigateTo({ url: "/pages/family-create/index" });
  },
  changeInviteCode(event: WechatMiniprogram.Input) {
    const inviteCode = event.detail.value.trim();
    this.setData({ inviteCode });
    wx.setStorageSync(INVITE_DRAFT_KEY, inviteCode);
  },
  joinFamily() {
    if (!this.data.inviteCode) {
      void wx.showToast({ title: "请先输入邀请码", icon: "none" });
      return;
    }
    void wx.showToast({ title: "邀请加入将在后续任务开放", icon: "none" });
  },
});
