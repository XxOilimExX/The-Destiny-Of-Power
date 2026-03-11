import { formatDate, formatPopulation } from "../../utils/formatters.js";
import { containsProfanity, sanitizeBio } from "../../utils/profanityFilter.js";
import { TITLES, RARITY_TABLE, CHEST_REWARDS } from "../social/SocialService.js";
import { CLOUD_ENABLED, CloudDB } from "../../services/CloudDB.js";

export class GameShell {
  static CUSTOM_AVATAR_SIZE = 256;
  static CUSTOM_AVATAR_MAX_BYTES = 512 * 1024;
  static CUSTOM_AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"];

  constructor(config, worldState, authService, socialService) {
    this.config = config;
    this.worldState = worldState;
    this.authService = authService;
    this.socialService = socialService;
    this.root = null;
    this.notifications = [];
    this.notifId = 0;
    this._chestTimer = null;
    this.state = {
      activeScreen: "solo",
      authMode: "register",
      currentUser: null,
      status: "",
      authError: "",
      isBusy: true,
      /* Multiplayer */
      multiplayerView: null,
      hostPassword: this.generatePassword(),
      hostRegion: "europe",
      joinPassword: "",
      serverInfo: null,
      serverBrowse: [],
      /* Game Phase */
      gamePhase: null,       // null | "picking" | "active"
      gameMode: null,        // "solo" | "multiplayer"
      lockedCountries: {},   // { countryCode: playerName }
      pickedCountry: null,   // current player's tentative pick
      pickRegionFilter: "all",
      botCount: 5,
      mpLoading: false,
      /* Social */
      friendSearch: "",
      friendSearchResults: [],
      friendSearchLoading: false,
      viewingProfile: null,
      /* Profile */
      bio: "",
      bioError: "",
      selectedAvatar: 0,
      selectedBanner: 0,
      selectedTitle: "recruit",
      customAvatar: "",
      /* Chest */
      chestResult: null,
      chestAnimating: false,
      settings: {
        language: config.defaultLanguage,
        animations: true,
        particles: true,
        screenShake: false,
        shadows: true,
        showFps: false,
        overlayIntensity: "balanced",
      },
    };
  }

  /* ─── Cosmetic Definitions ─────────────────────────── */
  static AVATARS = [
    { id: 0, label: "Default", icon: "&#9733;" },
    { id: 1, label: "Eagle", icon: "&#9670;" },
    { id: 2, label: "Wolf", icon: "&#9830;" },
    { id: 3, label: "Phoenix", icon: "&#9829;" },
    { id: 4, label: "Titan", icon: "&#9824;" },
    { id: 5, label: "Shadow", icon: "&#9827;" },
    { id: 6, label: "Dragon", icon: "&#9812;" },
    { id: 7, label: "Viper", icon: "&#9816;" },
    { id: 8, label: "Reaper", icon: "&#9760;" },
    { id: 9, label: "Celestial", icon: "&#10022;" },
    { id: 10, label: "Demon", icon: "&#9763;" },
    { id: 11, label: "Samurai", icon: "&#9876;" },
    { id: 12, label: "Knight", icon: "&#9814;" },
    { id: 13, label: "Ghost", icon: "&#9764;" },
    { id: 14, label: "Skull", icon: "&#9760;" },
  ];
  static BANNERS = [
    { id: 0, label: "Default", color: "#d81f2f" },
    { id: 1, label: "Crimson", color: "#8b0000" },
    { id: 2, label: "Midnight", color: "#1a0505" },
    { id: 3, label: "Gold", color: "#d4a843" },
    { id: 4, label: "Emerald", color: "#1a6b3c" },
    { id: 5, label: "Royal", color: "#4a1a8a" },
    { id: 6, label: "Arctic", color: "#1a5a7a" },
    { id: 7, label: "Inferno", color: "#ff4500" },
    { id: 8, label: "Void", color: "#0a0020" },
    { id: 9, label: "Neon", color: "#e91e9c" },
    { id: 10, label: "Blood Moon", color: "#6b0015" },
    { id: 11, label: "Frost", color: "#4a90b8" },
    { id: 12, label: "Toxic", color: "#3a6b1a" },
  ];

  generatePassword() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let pwd = "";
    const arr = new Uint8Array(6);
    crypto.getRandomValues(arr);
    for (const b of arr) pwd += chars[b % chars.length];
    return pwd;
  }

  async render() {
    this.root = document.querySelector("#app");
    if (!this.root) return;
    this.attachEvents();
    await this.loadSession();
    this.renderView();
  }

  attachEvents() {
    this.root.addEventListener("click", (e) => {
      const nav = e.target.closest("[data-screen]");
      const act = e.target.closest("[data-action]");

      if (nav) {
        this.state.activeScreen = nav.dataset.screen;
        if (nav.dataset.screen === "multiplayer") this.state.multiplayerView = null;
        if (nav.dataset.screen === "social" && this.state.currentUser) {
          // Background sync: pull cloud friend data, then re-render once done
          this.socialService.syncFromCloud(this.state.currentUser.username)
            .then(() => this.renderView())
            .catch(() => {});
        }
        this.renderView();
      }
      if (!act) return;

      const action = act.dataset.action;

      if (action === "set-auth-mode") {
        this.state.authMode = act.dataset.mode;
        this.state.authError = "";
        this.renderView();
      }
      if (action === "play-solo") {
        this.state.status = `Solo mode selected: ${this.worldState.getSelectedCountry()?.name ?? "No nation"}.`;
        this.renderView();
      }
      if (action === "enter-solo") {
        this.state.gamePhase = "picking";
        this.state.gameMode = "solo";
        this.state.lockedCountries = {};
        this.state.pickedCountry = null;
        this.state.pickRegionFilter = "all";
        this.renderView();
      }
      if (action === "pick-region") {
        this.state.pickRegionFilter = act.dataset.region;
        this.renderView();
      }
      if (action === "pick-country") {
        const code = act.dataset.code;
        if (!this.state.lockedCountries[code]) {
          this.state.pickedCountry = this.state.pickedCountry === code ? null : code;
          this.renderView();
        }
      }
      if (action === "confirm-pick") {
        if (!this.state.pickedCountry) return;
        const user = this.state.currentUser?.username ?? "Player";
        this.state.lockedCountries[this.state.pickedCountry] = user;
        this.worldState.setSelectedCountryCode(this.state.pickedCountry);
        if (this.state.gameMode === "solo") {
          const available = this.worldState.countries
            .filter((co) => !this.state.lockedCountries[co.code])
            .sort(() => Math.random() - 0.5)
            .slice(0, this.state.botCount);
          available.forEach((co, i) => { this.state.lockedCountries[co.code] = `Bot ${i + 1}`; });
        }
        this.state.gamePhase = "active";
        this.renderView();
      }
      if (action === "pick-back") {
        this.state.gamePhase = null;
        this.state.pickedCountry = null;
        this.state.lockedCountries = {};
        this.renderView();
      }
      if (action === "surrender") {
        this.state.gamePhase = null;
        this.state.pickedCountry = null;
        this.state.lockedCountries = {};
        this.renderView();
      }
      if (action === "mp-host") {
        this.state.multiplayerView = "host";
        this.state.hostPassword = this.generatePassword();
        this.renderView();
      }
      if (action === "mp-join") {
        this.state.multiplayerView = "join";
        this.state.joinPassword = "";
        this.renderView();
      }
      if (action === "mp-back") {
        this.state.multiplayerView = null;
        this.renderView();
      }
      if (action === "mp-refresh-pwd") {
        this.state.hostPassword = this.generatePassword();
        this.renderView();
      }
      if (action === "start-host") void this.handleStartHost();
      if (action === "start-join") void this.handleStartJoin();
      if (action === "browse-servers") void this.handleBrowseServers();
      if (action === "stop-server") void this.handleStopServer();
      if (action === "join-server-direct") {
        this.state.joinPassword = act.dataset.code;
        void this.handleStartJoin();
      }
      if (action === "friend-search") void this.handleFriendSearch();
      if (action === "send-request") void this.handleSendRequest(act.dataset.user);
      if (action === "accept-request") void this.handleAcceptRequest(act.dataset.user);
      if (action === "decline-request") void this.handleDeclineRequest(act.dataset.user);
      if (action === "remove-friend") void this.handleRemoveFriend(act.dataset.user);
      if (action === "view-profile") { this.state.viewingProfile = act.dataset.user; this.renderView(); }
      if (action === "close-profile-view") { this.state.viewingProfile = null; this.renderView(); }
      if (action === "save-bio") this.handleSaveBio();
      if (action === "select-avatar") this.handleSelectAvatar(Number(act.dataset.id));
      if (action === "select-banner") this.handleSelectBanner(Number(act.dataset.id));
      if (action === "select-title") this.handleSelectTitle(act.dataset.titleId);
      if (action === "open-chest") this.handleOpenChest();
      if (action === "upload-avatar") document.getElementById("avatar-upload")?.click();
      if (action === "remove-custom-avatar") this.handleRemoveCustomAvatar();
      if (action === "close-chest-result") { this.state.chestResult = null; this.renderView(); }
      if (action === "dismiss-notif") this.dismissNotification(Number(act.dataset.notifId));
      if (action === "logout") this.handleLogout();
    });

    this.root.addEventListener("change", (e) => {
      const t = e.target;
      if (t.matches("[data-country-select]")) {
        this.worldState.setSelectedCountryCode(t.value);
        this.renderView();
      }
      if (t.matches("[data-setting-language]")) {
        this.state.settings.language = t.value;
        this.renderView();
      }
      if (t.matches("[data-setting]")) {
        this.state.settings[t.dataset.setting] = t.checked;
        this.renderView();
      }
      if (t.matches("[data-setting-overlay]")) {
        this.state.settings.overlayIntensity = t.value;
        this.renderView();
      }
      if (t.matches("[data-host-region]")) {
        this.state.hostRegion = t.value;
        this.renderView();
      }
    });

    this.root.addEventListener("input", (e) => {
      const t = e.target;
      if (t.matches("[data-join-password]")) {
        this.state.joinPassword = t.value.toUpperCase().slice(0, 6);
      }
      if (t.matches("[data-friend-search]")) {
        this.state.friendSearch = t.value;
      }
      if (t.matches("[data-bio-input]")) {
        this.state.bio = t.value.slice(0, 50);
        this.state.bioError = "";
      }
    });

    this.root.addEventListener("change", (e) => {
      const t = e.target;
      if (t.matches("#avatar-upload")) {
        void this.handleAvatarUpload(t);
      }
    });

    this.root.addEventListener("submit", async (e) => {
      const form = e.target.closest("[data-auth-form]");
      if (!form) return;
      e.preventDefault();

      const fd = new FormData(form);
      const username = String(fd.get("username") ?? "").trim();
      const password = String(fd.get("password") ?? "");
      const passwordConfirm = String(fd.get("passwordConfirm") ?? "");

      this.state.isBusy = true;
      this.state.authError = "";
      this.renderView();

      try {
        const user = this.state.authMode === "login"
          ? await this.authService.login({ username, password })
          : await this.authService.register({ username, password, passwordConfirm });
        this.state.currentUser = user;
        this.state.activeScreen = "solo";
        this.state.status = `Signed in as ${user.username}.`;
        this.loadProfile();
        this.socialService.onNotification = (type, user) => this.handleSocialNotification(type, user);
        this.socialService.startOnlineSimulation(user.username);
        // Background sync of friend data from cloud
        this.socialService.syncFromCloud(user.username).catch(() => {});
      } catch (err) {
        this.state.authError = err.message;
      } finally {
        this.state.isBusy = false;
        this.renderView();
      }
    });
  }

  /* ─── Session ───────────────────────────────────── */
  async loadSession() {
    this.state.isBusy = true;
    this.renderView();
    this.state.currentUser = await this.authService.getCurrentUser();
    if (this.state.currentUser) {
      this.loadProfile();
      this.socialService.onNotification = (type, user) => this.handleSocialNotification(type, user);
      this.socialService.startOnlineSimulation(this.state.currentUser.username);
    }
    this.state.isBusy = false;
  }

  loadProfile() {
    if (!this.state.currentUser) return;
    const p = this.socialService.getProfile(this.state.currentUser.username);
    this.state.bio = p.bio || "";
    this.state.selectedAvatar = p.avatar || 0;
    this.state.selectedBanner = p.banner || 0;
    this.state.selectedTitle = p.title || "recruit";
    this.state.customAvatar = p.customAvatar || "";
  }

  async handleLogout() {
    this.socialService.stopOnlineSimulation();
    this.stopChestTimer();
    // Clean up any active hosted server
    if (this.state.serverInfo && this.state.multiplayerView === "hosting" && CLOUD_ENABLED) {
      await CloudDB.deleteServer(this.state.serverInfo.code).catch(() => {});
    }
    this.state.serverInfo = null;
    this.state.multiplayerView = null;
    await this.authService.logout();
    this.state.currentUser = null;
    this.state.authMode = "login";
    this.state.authError = "";
    this.renderView();
  }

  /* ─── Notifications ─────────────────────────────── */
  showNotification(type, message) {
    const id = ++this.notifId;
    this.notifications.push({ id, type, message, removing: false });
    this.renderNotifications();
    setTimeout(() => this.dismissNotification(id), 5000);
  }

  dismissNotification(id) {
    const n = this.notifications.find((n) => n.id === id);
    if (!n || n.removing) return;
    n.removing = true;
    this.renderNotifications();
    setTimeout(() => {
      this.notifications = this.notifications.filter((n) => n.id !== id);
      this.renderNotifications();
    }, 400);
  }

  handleSocialNotification(type, relatedUser) {
    const msgs = {
      sent: `Friend request sent to ${relatedUser}!`,
      accepted: `${relatedUser} accepted your friend request!`,
      online: `${relatedUser} is now online!`,
    };
    const notifType = type === "online" ? "online" : "social";
    this.showNotification(notifType, msgs[type] || `${relatedUser}: ${type}`);
  }

  renderNotifications() {
    let container = document.querySelector(".notif-container");
    if (!container) {
      container = document.createElement("div");
      container.className = "notif-container";
      document.body.appendChild(container);
    }
    container.innerHTML = this.notifications.map((n) => `
      <div class="notif notif--${n.type} ${n.removing ? "notif--exit" : ""}" data-notif-id="${n.id}">
        <div class="notif__icon">${n.type === "online" ? "●" : n.type === "social" ? "★" : n.type === "chest" ? "🎁" : "✓"}</div>
        <span class="notif__text">${n.message}</span>
        <button class="notif__close" data-action="dismiss-notif" data-notif-id="${n.id}">✕</button>
      </div>
    `).join("");
  }

  /* ─── Social Handlers ───────────────────────────── */
  async handleFriendSearch() {
    if (!this.state.currentUser) return;
    this.state.friendSearchLoading = true;
    this.renderView();
    this.state.friendSearchResults = await this.socialService.searchUsers(
      this.state.friendSearch, this.state.currentUser.username,
    );
    this.state.friendSearchLoading = false;
    this.renderView();
  }

  async handleSendRequest(toUser) {
    try {
      const result = await this.socialService.sendFriendRequest(this.state.currentUser.username, toUser);
      if (result === "accepted") {
        this.showNotification("social", `You and ${toUser} are now friends!`);
      } else {
        this.showNotification("social", `Friend request sent to ${toUser}!`);
      }
    } catch (err) {
      this.state.status = err.message;
    }
    this.renderView();
  }

  async handleAcceptRequest(fromUser) {
    try {
      await this.socialService.acceptRequest(this.state.currentUser.username, fromUser);
      this.showNotification("social", `You and ${fromUser} are now friends!`);
    } catch (err) {
      this.state.status = err.message;
    }
    this.renderView();
  }

  async handleDeclineRequest(fromUser) {
    await this.socialService.declineRequest(this.state.currentUser.username, fromUser);
    this.renderView();
  }

  async handleRemoveFriend(user) {
    await this.socialService.removeFriend(this.state.currentUser.username, user);
    this.renderView();
  }

  /* ─── Profile Handlers ─────────────────────────── */
  handleSaveBio() {
    const text = this.state.bio.trim().slice(0, 50);
    if (containsProfanity(text)) {
      this.state.bioError = "Your bio contains inappropriate language. Please remove it.";
      this.state.bio = sanitizeBio(text);
      this.renderView();
      return;
    }
    this.socialService.saveProfile(this.state.currentUser.username, { bio: text });
    this.state.bio = text;
    this.state.bioError = "";
    this.showNotification("success", "Bio saved!");
    this.renderView();
  }

  handleSelectAvatar(id) {
    const profile = this.socialService.getProfile(this.state.currentUser.username);
    if (!profile.unlockedAvatars.includes(id)) return;
    this.state.selectedAvatar = id;
    this.socialService.saveProfile(this.state.currentUser.username, { avatar: id });
    this.renderView();
  }

  handleSelectBanner(id) {
    const profile = this.socialService.getProfile(this.state.currentUser.username);
    if (!profile.unlockedBanners.includes(id)) return;
    this.state.selectedBanner = id;
    this.socialService.saveProfile(this.state.currentUser.username, { banner: id });
    this.renderView();
  }

  async handleAvatarUpload(input) {
    const file = input.files?.[0];
    if (!file) return;

    if (!GameShell.CUSTOM_AVATAR_TYPES.includes(file.type)) {
      this.showNotification("success", "Only PNG, JPG, and WEBP images are allowed.");
      input.value = "";
      return;
    }

    if (file.size > GameShell.CUSTOM_AVATAR_MAX_BYTES) {
      this.showNotification("success", "Image too large. Max 512 KB.");
      input.value = "";
      return;
    }

    if (containsProfanity(file.name)) {
      this.showNotification("success", "Please rename that file before uploading it.");
      input.value = "";
      return;
    }

    try {
      const dataUrl = await this.prepareCustomAvatar(file);
      this.state.customAvatar = dataUrl;
      this.socialService.saveProfile(this.state.currentUser.username, { customAvatar: dataUrl });
      this.showNotification("success", "Custom profile picture set!");
      this.renderView();
    } catch {
      this.showNotification("success", "That image could not be used.");
    } finally {
      input.value = "";
    }
  }

  handleRemoveCustomAvatar() {
    this.state.customAvatar = "";
    this.socialService.saveProfile(this.state.currentUser.username, { customAvatar: "" });
    this.showNotification("success", "Custom avatar removed.");
    this.renderView();
  }

  handleSelectTitle(titleId) {
    const profile = this.socialService.getProfile(this.state.currentUser.username);
    if (!profile.unlockedTitles.includes(titleId)) return;
    this.state.selectedTitle = titleId;
    this.socialService.saveProfile(this.state.currentUser.username, { title: titleId });
    this.renderView();
  }

  handleOpenChest() {
    if (!this.state.currentUser) return;
    try {
      const result = this.socialService.openChest(this.state.currentUser.username);
      this.state.chestResult = result;
      this.loadProfile();
      const rarityColor = RARITY_TABLE.find((r) => r.rarity === result.rarity)?.color || "#fff";
      const msg = result.duplicate
        ? `Duplicate ${result.rarity} ${result.category}: ${result.reward.label}`
        : `New ${result.rarity} ${result.category}: ${result.reward.label}!`;
      this.showNotification("chest", msg);
    } catch {
      this.state.status = "Chest is still on cooldown!";
    }
    this.renderView();
  }

  getTitle(titleId) {
    return TITLES.find((t) => t.id === titleId)?.label || "Recruit";
  }

  /* ─── Multiplayer Handlers (cloud-aware) ────────── */
  async handleStartHost() {
    const code = this.state.hostPassword;
    const region = this.state.hostRegion;
    const host = this.state.currentUser.username;

    this.state.mpLoading = true;
    this.renderView();

    if (CLOUD_ENABLED && CloudDB.ready()) {
      await CloudDB.createServer({ code, host, region });
    }

    this.state.serverInfo = { code, host, region, players: [host] };
    this.state.multiplayerView = "hosting";
    this.state.status = `Hosting ${region.replace(/-/g, " ")} server · Code: ${code}`;
    this.state.mpLoading = false;
    this.showNotification("success", CLOUD_ENABLED ? `Server live in ${region.replace(/-/g, " ")}!` : `Server code generated. Share it locally!`);
    this.renderView();
  }

  async handleStartJoin() {
    const code = this.state.joinPassword.toUpperCase().trim();
    if (code.length < 4) {
      this.state.status = "Enter a valid server code.";
      this.renderView();
      return;
    }

    this.state.mpLoading = true;
    this.renderView();

    if (CLOUD_ENABLED && CloudDB.ready()) {
      const server = await CloudDB.joinServer(code, this.state.currentUser.username);
      if (server) {
        this.state.serverInfo = server;
        this.state.multiplayerView = "lobby";
        this.state.status = `Connected to ${server.host}'s server.`;
        this.showNotification("success", `Joined ${server.host}'s server!`);
      } else {
        this.state.status = "Server not found. Check the code and try again.";
        this.showNotification("success", "Server not found.");
      }
    } else {
      // Local mode: just display the lobby with the code
      this.state.serverInfo = { code, host: "Unknown Host", region: "local", players: [this.state.currentUser.username] };
      this.state.multiplayerView = "lobby";
      this.state.status = `Joining server ${code}…`;
      this.showNotification("success", "Connecting to server…");
    }

    this.state.mpLoading = false;
    this.renderView();
  }

  async handleBrowseServers() {
    this.state.multiplayerView = "browse";
    this.state.mpLoading = true;
    this.state.serverBrowse = [];
    this.renderView();

    if (CLOUD_ENABLED && CloudDB.ready()) {
      this.state.serverBrowse = await CloudDB.getPublicServers();
    }

    this.state.mpLoading = false;
    this.renderView();
  }

  async handleStopServer() {
    if (this.state.serverInfo && CLOUD_ENABLED) {
      await CloudDB.deleteServer(this.state.serverInfo.code).catch(() => {});
    }
    this.state.serverInfo = null;
    this.state.multiplayerView = null;
    this.state.status = "Server stopped.";
    this.renderView();
  }

  prepareCustomAvatar(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("read_failed"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("decode_failed"));
        img.onload = () => {
          if (img.width < 64 || img.height < 64) {
            reject(new Error("too_small"));
            return;
          }

          const size = GameShell.CUSTOM_AVATAR_SIZE;
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;

          const context = canvas.getContext("2d");
          if (!context) {
            reject(new Error("canvas_failed"));
            return;
          }

          const scale = Math.max(size / img.width, size / img.height);
          const drawWidth = img.width * scale;
          const drawHeight = img.height * scale;
          const offsetX = (size - drawWidth) / 2;
          const offsetY = (size - drawHeight) / 2;

          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "high";
          context.clearRect(0, 0, size, size);
          context.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
          resolve(canvas.toDataURL("image/webp", 0.9));
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  getAvatarHtml(customAvatar, avatarId) {
    if (customAvatar) return `<img src="${customAvatar}" alt="avatar" class="custom-avatar-img" />`;
    return GameShell.AVATARS[avatarId]?.icon ?? "&#9733;";
  }

  /* ─── Chest Cooldown Timer ──────────────────────── */
  startChestTimer() {
    this.stopChestTimer();
    this._chestTimer = setInterval(() => {
      if (!this.state.currentUser) return;
      const el = document.querySelector(".chest-cooldown__time");
      if (!el) { this.stopChestTimer(); return; }
      const ms = this.socialService.getChestCooldownRemaining(this.state.currentUser.username);
      if (ms <= 0) {
        this.stopChestTimer();
        this.renderView();
        return;
      }
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      el.textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }, 1000);
  }

  stopChestTimer() {
    if (this._chestTimer) { clearInterval(this._chestTimer); this._chestTimer = null; }
  }

  /* ─── Background ────────────────────────────────── */
  renderBackground() {
    return `
      <div class="bg bg__space"></div>
      <div class="bg bg__nebula"></div>
      <div class="bg bg__stars"></div>
      <div class="bg bg__stars-deep"></div>
      <div class="bg bg__vignette"></div>
      <div class="earth-wrap">
        <div class="earth-glow"></div>
        <div class="earth-orbit earth-orbit--a"></div>
        <div class="earth-orbit earth-orbit--b"></div>
        <div class="globe">
          <div class="globe__ocean"></div>
          <div class="globe__land"></div>
          <div class="globe__clouds"></div>
          <div class="globe__shadow"></div>
          <div class="globe__atmo"></div>
          <div class="globe__fresnel"></div>
        </div>
      </div>
    `;
  }

  /* ─── Main Render ───────────────────────────────── */
  renderView() {
    const country = this.worldState.getSelectedCountry();
    if (!this.root || !country) return;

    // Manage chest cooldown timer
    if (this.state.activeScreen === "personal" && this.state.currentUser) {
      requestAnimationFrame(() => this.startChestTimer());
    } else {
      this.stopChestTimer();
    }

    this.root.innerHTML = `
      <div class="game-root ${this.state.settings.animations ? "" : "no-motion"}">
        ${this.renderBackground()}
        <div class="hud">
          <header class="panel topbar">
            <div class="topbar__brand">
              <div class="topbar__icon">TDP</div>
              <div>
                <h1 class="topbar__title">${this.config.title}</h1>
                <p class="topbar__subtitle">Global Strategy Network</p>
              </div>
            </div>
            <div class="topbar__info">
              <span class="tag">Year ${this.config.startYear}</span>
              <span class="tag">${this.config.turnLength}</span>
              <span class="tag">${this.state.settings.language.toUpperCase()}</span>
            </div>
          </header>
          ${this.state.currentUser ? this.renderMain(country) : this.renderAuth()}
        </div>
      </div>
    `;
  }

  renderMain(country) {
    return `
      <section class="main-layout">
        <nav class="panel sidebar">
          <div class="user-card">
            <div class="user-card__avatar">${this.getAvatarHtml(this.state.customAvatar, this.state.selectedAvatar)}</div>
            <div>
              <div class="user-card__name">${this.state.currentUser.username}</div>
              <div class="user-card__role">${this.getTitle(this.state.selectedTitle)}</div>
            </div>
          </div>
          <div class="nav-group">
            ${this.navItem("solo", "Solo Mode", "Singleplayer world takeover")}
            ${this.navItem("multiplayer", "Multiplayer", "PvP & alliance warfare")}
            ${this.navItem("social", "Social", "Friends and connections")}
            ${this.navItem("settings", "Settings", "Graphics and interface")}
            ${this.navItem("personal", "Profile", "Account & customization")}
            <button class="nav-item nav-item--danger" type="button" data-action="logout">
              <div class="nav-item__icon">&#10539;</div>
              <div class="nav-item__text">
                <span class="nav-item__label">Sign Out</span>
                <span class="nav-item__desc">Leave the command network</span>
              </div>
            </button>
          </div>
        </nav>
        <section class="content">
          <div class="panel hero">
            <div class="hero__text">
              <p class="hero__label">Global Conflict</p>
              <h2>Choose Your Mode. Choose Your Nation.</h2>
              <p>Lock in the experience first, then enter the world with a clear objective and a dangerous atmosphere.</p>
            </div>
            <div class="hero__stats">
              <div class="stat">
                <span class="stat__label">Nation</span>
                <strong class="stat__value">${country.name}</strong>
              </div>
              <div class="stat">
                <span class="stat__label">Population</span>
                <strong class="stat__value">${formatPopulation(country.population)}</strong>
              </div>
              <div class="stat">
                <span class="stat__label">Active Mode</span>
                <strong class="stat__value">${this.screenLabel(this.state.activeScreen)}</strong>
              </div>
            </div>
          </div>
          <div class="panel screen">
            ${this.renderScreen(country)}
          </div>
          <footer class="panel bottombar">
            <div class="bottombar__status">
              <span class="bottombar__dot"></span>
              <span>${this.state.status || "All systems online"}</span>
            </div>
            <div class="bottombar__actions">
              <button class="bottombar__btn" type="button" data-screen="solo">Solo</button>
              <button class="bottombar__btn" type="button" data-screen="multiplayer">MP</button>
              <button class="bottombar__btn" type="button" data-screen="social">Social</button>
              <button class="bottombar__btn" type="button" data-screen="settings">Settings</button>
            </div>
          </footer>
        </section>
      </section>
    `;
  }

  renderAuth() {
    const isLogin = this.state.authMode === "login";
    return `
      <section class="auth-stage">
        <div class="panel auth-box">
          <div class="auth-box__logo">
            <span class="auth-box__logo-text">TDP</span>
          </div>
          <div class="auth-switch">
            <button class="auth-switch__btn ${isLogin ? "is-active" : ""}" type="button" data-action="set-auth-mode" data-mode="login">Already Have An Account</button>
            <button class="auth-switch__btn ${!isLogin ? "is-active" : ""}" type="button" data-action="set-auth-mode" data-mode="register">Create Account</button>
          </div>
          <h2>${isLogin ? "Sign In To Command" : "Create Your Commander"}</h2>
          <p>${isLogin ? "Use your existing account to enter the control room." : "Set up a secure profile to enter the global command network."}</p>
          <div class="notice">
            <strong>Important</strong>
            <p>${isLogin ? "Use the commander name you already registered." : "Choose a unique alias. Do not use your real name."}</p>
          </div>
          <form class="auth-form" data-auth-form>
            <label>
              <span class="auth-form__label">Username</span>
              <input name="username" type="text" minlength="3" maxlength="20" placeholder="e.g. Commander Atlas" required />
            </label>
            <label>
              <span class="auth-form__label">Password</span>
              <input name="password" type="password" minlength="8" placeholder="Minimum 8 characters" required />
            </label>
            ${isLogin ? "" : `<label>
              <span class="auth-form__label">Confirm Password</span>
              <input name="passwordConfirm" type="password" minlength="8" placeholder="Repeat password" required />
            </label>`}
            <button class="btn btn--primary btn--wide btn--lg" type="submit" ${this.state.isBusy ? "disabled" : ""}>
              ${this.state.isBusy ? "Verifying..." : isLogin ? "Sign In" : "Create Profile & Enter"}
            </button>
          </form>
          <div class="auth-form__foot">
            <span class="tag">Black Red Interface</span>
            <span class="tag">UI Preview Build</span>
          </div>
          ${this.state.authError ? `<p class="error-msg">${this.state.authError}</p>` : ""}
        </div>
      </section>
    `;
  }

  navItem(screen, title, desc) {
    const active = this.state.activeScreen === screen;
    const icons = { solo: "&#9876;", multiplayer: "&#9813;", social: "&#9829;", settings: "&#9881;", personal: "&#9733;" };
    return `
      <button class="nav-item ${active ? "is-active" : ""}" type="button" data-screen="${screen}">
        <div class="nav-item__icon">${icons[screen] || ""}</div>
        <div class="nav-item__text">
          <span class="nav-item__label">${title}</span>
          <span class="nav-item__desc">${desc}</span>
        </div>
      </button>
    `;
  }

  renderScreen(country) {
    if (this.state.gamePhase === "picking") return this.screenCountryPick();
    if (this.state.gamePhase === "active") return this.screenGameActive();
    switch (this.state.activeScreen) {
      case "multiplayer": return this.screenMultiplayer();
      case "social": return this.screenSocial();
      case "settings": return this.screenSettings();
      case "personal": return this.screenPersonal(country);
      default: return this.screenSolo(country);
    }
  }

  /* ─── Solo Screen (router) ──────────────────────── */
  screenSolo(c) {
    return this.screenSoloLobby(c);
  }

  /* ─── Solo Lobby ────────────────────────────────── */
  screenSoloLobby(c) {
    return `
      <div class="screen__head">
        <p class="screen__tag">Solo Operations</p>
        <h2>Solo Mode</h2>
        <p>Pick a real-world nation and rise to power. Be the last country standing.</p>
      </div>
      <div class="solo-grid">
        <article class="card card--highlight">
          <span class="card__label">Selected Nation</span>
          <strong class="card__value">${c.name}</strong>
          <p>Capital: ${c.capital}</p>
          <div class="country-sel">
            <span class="country-sel__label">Switch country</span>
            <select data-country-select>
              ${this.worldState.countries.map(
                (co) => `<option value="${co.code}" ${co.code === c.code ? "selected" : ""}>${co.name}</option>`,
              ).join("")}
            </select>
            <button class="btn btn--primary btn--wide" type="button" data-action="enter-solo">Enter Solo Match &#10132;</button>
          </div>
        </article>
        <div class="cards">
          <article class="card">
            <span class="card__label">Economy</span>
            <strong class="card__value">${c.economyScore}</strong>
            <p>Industrial output and trade power drive your expansion.</p>
          </article>
          <article class="card">
            <span class="card__label">Military</span>
            <strong class="card__value">${c.militaryScore}</strong>
            <p>Armed forces, deterrence and global force projection.</p>
          </article>
          <article class="card">
            <span class="card__label">Stability</span>
            <strong class="card__value">${c.stabilityScore}</strong>
            <p>Internal cohesion that keeps your nation from collapse.</p>
          </article>
        </div>
      </div>
    `;
  }

  /* ─── Country Pick Screen ───────────────────────── */
  screenCountryPick() {
    const countries = this.worldState.countries;
    const filter = this.state.pickRegionFilter;
    const regions = ["all", "North America", "South America", "Europe", "Eurasia", "Middle East", "Africa", "Asia", "Oceania"];
    const visible = filter === "all" ? countries : countries.filter((co) => co.region === filter);
    const picked = this.state.pickedCountry;
    const locked = this.state.lockedCountries;
    const pickedData = picked ? countries.find((co) => co.code === picked) : null;

    return `
      <div class="pick-screen">
        <div class="pick-screen__header">
          <button class="btn btn--ghost" type="button" data-action="pick-back">&#8592; Back</button>
          <div class="pick-screen__title">
            <p class="screen__tag">SOLO MATCH</p>
            <h2>Choose Your Nation</h2>
            <p>Select a country to lead to global dominance. Be the last one standing.</p>
          </div>
        </div>

        <div class="pick-region-tabs">
          ${regions.map((r) => `
            <button class="pick-tab${filter === r ? " pick-tab--active" : ""}"
              type="button" data-action="pick-region" data-region="${r}">
              ${r === "all" ? "All Regions" : r}
            </button>
          `).join("")}
        </div>

        <div class="country-pick-grid">
          ${visible.map((co) => {
            const isLocked = !!locked[co.code];
            const isSelected = picked === co.code;
            const lockedBy = locked[co.code];
            return `
              <button class="country-card${isLocked ? " country-card--locked" : ""}${isSelected ? " country-card--selected" : ""}"
                type="button" data-action="pick-country" data-code="${co.code}"
                ${isLocked ? "disabled" : ""}>
                <div class="country-card__swatch" style="background:${co.color}"></div>
                <div class="country-card__body">
                  <div class="country-card__name">${co.name}</div>
                  <div class="country-card__capital">&#9670; ${co.capital}</div>
                  <div class="country-card__region-tag">${co.region}</div>
                  <div class="country-card__stats">
                    ${this.miniStatBar("ECO", co.economyScore)}
                    ${this.miniStatBar("MIL", co.militaryScore)}
                    ${this.miniStatBar("STB", co.stabilityScore)}
                  </div>
                </div>
                ${isLocked ? `<div class="country-card__lock-overlay">&#128274; ${lockedBy === (this.state.currentUser?.username ?? "") ? "YOUR PICK" : "LOCKED"}</div>` : ""}
                ${isSelected ? `<div class="country-card__selected-badge">&#10003; SELECTED</div>` : ""}
              </button>
            `;
          }).join("")}
        </div>

        <div class="pick-confirm-bar${pickedData ? " pick-confirm-bar--active" : ""}">
          ${pickedData ? `
            <div class="pick-confirm-bar__preview">
              <div class="pick-confirm-bar__swatch" style="background:${pickedData.color}"></div>
              <div>
                <div class="pick-confirm-bar__name">${pickedData.name}</div>
                <div class="pick-confirm-bar__region">${pickedData.region}</div>
              </div>
            </div>
            <button class="btn btn--primary" type="button" data-action="confirm-pick">
              Confirm &amp; Start Match &#10132;
            </button>
          ` : `<p class="pick-confirm-bar__hint">&#11013; Select a nation above to begin</p>`}
        </div>
      </div>
    `;
  }

  miniStatBar(label, score) {
    const pct = Math.min(100, Math.round(score));
    return `
      <div class="stat-mini">
        <span class="stat-mini__label">${label}</span>
        <div class="stat-mini__bar"><div class="stat-mini__fill" style="width:${pct}%"></div></div>
        <span class="stat-mini__val">${score}</span>
      </div>
    `;
  }

  /* ─── Active Game Screen ────────────────────────── */
  screenGameActive() {
    const countries = this.worldState.countries;
    const playerCode = this.worldState.selectedCountryCode;
    const player = countries.find((co) => co.code === playerCode) ?? countries[0];
    const locked = this.state.lockedCountries;
    const username = this.state.currentUser?.username ?? "Player";

    const participants = Object.entries(locked).map(([code, name]) => ({
      code,
      name,
      country: countries.find((co) => co.code === code),
      isPlayer: name === username,
    }));

    return `
      <div class="game-active">
        <div class="game-active__header">
          <div class="game-active__flag" style="background:${player.color}"></div>
          <div class="game-active__info">
            <h2>${player.name}</h2>
            <p>${player.capital} &middot; <span class="game-active__badge">&#9679; ACTIVE MATCH</span></p>
          </div>
          <button class="btn btn--danger" type="button" data-action="surrender">&#9873; Surrender</button>
        </div>

        <div class="game-active__panels">
          <div class="game-active__panel">
            <h3 class="game-active__panel-title">Your Nation</h3>
            ${this.gameStatBar("Economy", player.economyScore, "#4ade80")}
            ${this.gameStatBar("Military", player.militaryScore, "#f87171")}
            ${this.gameStatBar("Stability", player.stabilityScore, "#60a5fa")}
          </div>
          <div class="game-active__panel">
            <h3 class="game-active__panel-title">Match Players <span class="social-count">${participants.length}</span></h3>
            <div class="player-list">
              ${participants.map((p) => `
                <div class="player-list__item${p.isPlayer ? " player-list__item--you" : ""}">
                  <div class="player-list__swatch" style="background:${p.country?.color ?? "#666"}"></div>
                  <div class="player-list__info">
                    <div class="player-list__name">${p.name}${p.isPlayer ? ` <span class="social-badge social-badge--friend">YOU</span>` : ""}</div>
                    <div class="player-list__country">${p.country?.name ?? p.code}</div>
                  </div>
                </div>
              `).join("")}
            </div>
          </div>
        </div>

        <h3 class="game-active__panel-title" style="margin:20px 0 10px">Actions</h3>
        <div class="game-actions">
          <button class="game-btn game-btn--disabled" type="button" disabled>
            <span class="game-btn__icon">&#9876;</span>
            <span class="game-btn__label">Attack</span>
            <span class="game-btn__soon">Coming Soon</span>
          </button>
          <button class="game-btn game-btn--disabled" type="button" disabled>
            <span class="game-btn__icon">&#129309;</span>
            <span class="game-btn__label">Negotiate</span>
            <span class="game-btn__soon">Coming Soon</span>
          </button>
          <button class="game-btn game-btn--disabled" type="button" disabled>
            <span class="game-btn__icon">&#127963;</span>
            <span class="game-btn__label">Fortify</span>
            <span class="game-btn__soon">Coming Soon</span>
          </button>
          <button class="game-btn game-btn--disabled" type="button" disabled>
            <span class="game-btn__icon">&#127759;</span>
            <span class="game-btn__label">View Map</span>
            <span class="game-btn__soon">Coming Soon</span>
          </button>
        </div>
      </div>
    `;
  }

  gameStatBar(label, score, color) {
    return `
      <div class="game-stat">
        <div class="game-stat__head">
          <span class="game-stat__label">${label}</span>
          <span class="game-stat__val">${score}</span>
        </div>
        <div class="game-stat__bar">
          <div class="game-stat__fill" style="width:${Math.min(100, score)}%;background:${color}"></div>
        </div>
      </div>
    `;
  }

  /* ─── Multiplayer Screen ────────────────────────── */
  screenMultiplayer() {
    if (this.state.multiplayerView === "host") return this.screenMpHost();
    if (this.state.multiplayerView === "join") return this.screenMpJoin();
    if (this.state.multiplayerView === "hosting") return this.screenMpHosting();
    if (this.state.multiplayerView === "browse") return this.screenMpBrowse();
    if (this.state.multiplayerView === "lobby") return this.screenMpLobby();

    const cloudBadge = CLOUD_ENABLED
      ? `<span class="cloud-badge cloud-badge--online">&#9728; Online</span>`
      : `<span class="cloud-badge cloud-badge--local">&#9711; Local Mode</span>`;

    return `
      <div class="screen__head">
        <p class="screen__tag">Multiplayer ${cloudBadge}</p>
        <h2>Multiplayer Mode</h2>
        <p>Choose how you want to play with other commanders ${CLOUD_ENABLED ? "worldwide" : "on this device"}.</p>
      </div>
      <div class="mp-options">
        <button class="mp-option" type="button" data-action="mp-host">
          <div class="mp-option__icon">&#9873;</div>
          <div class="mp-option__text">
            <strong>Host A Server</strong>
            <p>Create a room with a unique code. Select your region and invite others to join.</p>
          </div>
          <div class="mp-option__arrow">&#10132;</div>
        </button>
        <button class="mp-option" type="button" data-action="mp-join">
          <div class="mp-option__icon">&#9889;</div>
          <div class="mp-option__text">
            <strong>Join A Server</strong>
            <p>Enter a server code to connect to an existing match hosted by another commander.</p>
          </div>
          <div class="mp-option__arrow">&#10132;</div>
        </button>
        <button class="mp-option ${!CLOUD_ENABLED ? "mp-option--disabled" : ""}" type="button" data-action="browse-servers" ${!CLOUD_ENABLED ? "title='Requires Firebase'" : ""}>
          <div class="mp-option__icon">&#9741;</div>
          <div class="mp-option__text">
            <strong>Browse Public Servers</strong>
            <p>${CLOUD_ENABLED ? "Explore open servers from commanders around the world." : "Connect to Firebase to browse worldwide servers."}</p>
          </div>
          <div class="mp-option__arrow">&#10132;</div>
        </button>
      </div>
    `;
  }

  screenMpHosting() {
    const s = this.state.serverInfo;
    return `
      <div class="screen__head">
        <p class="screen__tag">Live Server <span class="mp-live-dot">&#9679; LIVE</span></p>
        <h2>Your Server Is Active</h2>
        <p>Share the code below with the commanders you want to invite.</p>
      </div>
      <div class="mp-host-panel">
        <div class="mp-code-box">
          <span class="mp-code-box__label">Server Code</span>
          <div class="mp-code-box__value">${s.code}</div>
        </div>
        <div class="mp-server-info">
          <div class="mp-server-info__row">
            <span>Region</span>
            <strong>${s.region.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</strong>
          </div>
          <div class="mp-server-info__row">
            <span>Host</span>
            <strong>${s.host}</strong>
          </div>
        </div>
        <div class="profile-section" style="margin-top:14px">
          <h3 class="profile-section__title">Players <span class="social-count">${s.players.length}</span></h3>
          <div class="social-results">
            ${s.players.map((p) => `
              <div class="social-user">
                <div class="social-user__name">${p}${p === s.host ? ` <span class="social-badge social-badge--friend">Host</span>` : ""}</div>
              </div>`).join("")}
          </div>
        </div>
        <button class="btn btn--danger btn--wide" type="button" data-action="stop-server" style="margin-top:16px">Stop Server</button>
      </div>
    `;
  }

  screenMpBrowse() {
    const servers = this.state.serverBrowse;
    return `
      <div class="screen__head">
        <button class="btn btn--ghost" type="button" data-action="mp-back">&#8592; Back</button>
        <p class="screen__tag" style="margin-top:12px">Public Servers</p>
        <h2>Browse Servers</h2>
        <p>Join an active game hosted by another commander worldwide.</p>
      </div>
      ${this.state.mpLoading ? `<div class="loading-state">Scanning for servers worldwide&#8230;</div>` : ""}
      ${!this.state.mpLoading && servers.length === 0 ? `
        <div class="social-empty-state">
          <p>No public servers found right now. Be the first to host one!</p>
          <button class="btn btn--primary" type="button" data-action="mp-host">Host A Server</button>
        </div>` : ""}
      ${servers.length > 0 ? `
        <div class="social-results" style="margin-top:12px">
          ${servers.map((s) => `
            <div class="social-user">
              <div class="social-user__info">
                <div class="social-user__name">${s.host}'s Server</div>
                <div class="social-user__status">${s.region.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} &middot; ${s.players.length} player${s.players.length !== 1 ? "s" : ""} &middot; Code: ${s.code}</div>
              </div>
              <button class="btn btn--primary" type="button" data-action="join-server-direct" data-code="${s.code}">Join</button>
            </div>`).join("")}
        </div>` : ""}
    `;
  }

  screenMpLobby() {
    const s = this.state.serverInfo;
    return `
      <div class="screen__head">
        <button class="btn btn--ghost" type="button" data-action="mp-back">&#8592; Leave Server</button>
        <p class="screen__tag" style="margin-top:12px">Game Lobby</p>
        <h2>${s.host}'s Server</h2>
        <p>Waiting for the match to begin.</p>
      </div>
      <div class="mp-host-panel">
        <div class="mp-server-info">
          <div class="mp-server-info__row">
            <span>Server Code</span>
            <strong>${s.code}</strong>
          </div>
          <div class="mp-server-info__row">
            <span>Region</span>
            <strong>${s.region.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</strong>
          </div>
        </div>
        <div class="profile-section" style="margin-top:14px">
          <h3 class="profile-section__title">Players <span class="social-count">${s.players.length}</span></h3>
          <div class="social-results">
            ${s.players.map((p) => `
              <div class="social-user">
                <div class="social-user__name">${p}${p === s.host ? ` <span class="social-badge social-badge--friend">Host</span>` : ""}</div>
              </div>`).join("")}
          </div>
        </div>
      </div>
    `;
  }

  screenMpHost() {
    return `
      <div class="screen__head">
        <button class="btn btn--ghost" type="button" data-action="mp-back">&#8592; Back</button>
        <p class="screen__tag" style="margin-top: 12px;">Host A Server</p>
        <h2>Create Your Server</h2>
        <p>Share the server code below with the commanders you want to invite.</p>
      </div>

      <div class="mp-host-panel">
        <div class="mp-code-box">
          <span class="mp-code-box__label">Server Code</span>
          <div class="mp-code-box__value">${this.state.hostPassword}</div>
          <button class="btn btn--ghost" type="button" data-action="mp-refresh-pwd">&#8635; New Code</button>
        </div>

        <div class="mp-region">
          <span class="mp-region__label">Server Region</span>
          <div class="mp-region__options">
            <label class="mp-region__option ${this.state.hostRegion === "europe" ? "is-active" : ""}">
              <input type="radio" name="region" value="europe" data-host-region ${this.state.hostRegion === "europe" ? "checked" : ""} />
              <span class="mp-region__icon">&#127466;&#127482;</span>
              <span>Europe</span>
            </label>
            <label class="mp-region__option ${this.state.hostRegion === "north-america" ? "is-active" : ""}">
              <input type="radio" name="region" value="north-america" data-host-region ${this.state.hostRegion === "north-america" ? "checked" : ""} />
              <span class="mp-region__icon">&#127482;&#127480;</span>
              <span>North America</span>
            </label>
            <label class="mp-region__option ${this.state.hostRegion === "asia" ? "is-active" : ""}">
              <input type="radio" name="region" value="asia" data-host-region ${this.state.hostRegion === "asia" ? "checked" : ""} />
              <span class="mp-region__icon">&#127471;&#127477;</span>
              <span>Asia</span>
            </label>
          </div>
        </div>

        <button class="btn btn--primary btn--wide btn--lg" type="button" data-action="start-host">Host Server</button>
      </div>
    `;
  }

  screenMpJoin() {
    return `
      <div class="screen__head">
        <button class="btn btn--ghost" type="button" data-action="mp-back">&#8592; Back</button>
        <p class="screen__tag" style="margin-top: 12px;">Join A Server</p>
        <h2>Enter Server Code</h2>
        <p>Ask the host for the 6-character server code and enter it below.</p>
      </div>

      <div class="mp-join-panel">
        <div class="mp-code-input">
          <span class="mp-code-input__label">Server Code</span>
          <input type="text" data-join-password maxlength="6" placeholder="e.g. XK7P2M" value="${this.state.joinPassword}" autocomplete="off" spellcheck="false" />
        </div>
        <button class="btn btn--primary btn--wide btn--lg" type="button" data-action="start-join">Join Server</button>
      </div>
    `;
  }

  /* ─── Social Screen ─────────────────────────────── */
  screenSocial() {
    const user = this.state.currentUser.username;
    const incoming = this.socialService.getIncomingRequests(user);
    const friends = this.socialService.getFriends(user);

    // Profile view overlay
    if (this.state.viewingProfile) {
      return this.renderProfileView(this.state.viewingProfile);
    }

    const cloudBadge = CLOUD_ENABLED
      ? `<span class="cloud-badge cloud-badge--online">&#9728; Online — worldwide search active</span>`
      : `<span class="cloud-badge cloud-badge--local">&#9711; Local Mode — <a href="#" style="color:inherit;text-decoration:underline" title="Fill in src/config/cloud.js to go global">set up Firebase</a> to search globally</span>`;

    return `
      <div class="screen__head">
        <p class="screen__tag">Social Hub</p>
        <h2>Social</h2>
        <p>Find other commanders, send friend requests and manage your connections.</p>
        <div style="margin-top:8px">${cloudBadge}</div>
      </div>

      <div class="social-grid">
        <!-- Search -->
        <div class="social-section">
          <h3 class="social-section__title">Find Commanders</h3>
          <div class="social-search">
            <input type="text" data-friend-search placeholder="Search by username…" value="${this.state.friendSearch}" />
            <button class="btn btn--primary" type="button" data-action="friend-search" ${this.state.friendSearchLoading ? "disabled" : ""}>
              ${this.state.friendSearchLoading ? "Searching…" : "Search"}
            </button>
          </div>
          ${this.state.friendSearchLoading ? `<div class="loading-state">Searching commanders ${CLOUD_ENABLED ? "worldwide" : "locally"}&#8230;</div>` : ""}
          ${!this.state.friendSearchLoading && this.state.friendSearchResults.length > 0 ? `
            <div class="social-results">
              ${this.state.friendSearchResults.map((u) => {
                const isFriend = friends.includes(u);
                const hasPending = this.socialService.getOutgoingRequests(user).some((r) => r.to === u);
                const pr = this.socialService.getProfile(u);
                const titleLabel = this.getTitle(pr.title);
                return `
                  <div class="social-user">
                    <div class="social-user__info">
                      <button class="social-user__name social-user__name--link" type="button" data-action="view-profile" data-user="${u}">${u}</button>
                      <div class="social-user__status">${titleLabel}</div>
                    </div>
                    ${isFriend
                      ? `<span class="social-badge social-badge--friend">Friends</span>`
                      : hasPending
                        ? `<span class="social-badge social-badge--pending">Pending</span>`
                        : `<button class="btn btn--ghost" type="button" data-action="send-request" data-user="${u}">Add Friend</button>`
                    }
                  </div>
                `;
              }).join("")}
            </div>
          ` : ""}
        </div>

        <!-- Incoming Requests -->
        ${incoming.length > 0 ? `
          <div class="social-section">
            <h3 class="social-section__title">Friend Requests <span class="social-count">${incoming.length}</span></h3>
            <div class="social-results">
              ${incoming.map((r) => `
                <div class="social-user">
                  <button class="social-user__name social-user__name--link" type="button" data-action="view-profile" data-user="${r.from}">${r.from}</button>
                  <div class="social-user__actions">
                    <button class="btn btn--primary" type="button" data-action="accept-request" data-user="${r.from}">Accept</button>
                    <button class="btn btn--danger" type="button" data-action="decline-request" data-user="${r.from}">Decline</button>
                  </div>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}

        <!-- Friends List -->
        <div class="social-section">
          <h3 class="social-section__title">Friends <span class="social-count">${friends.length}</span></h3>
          ${friends.length > 0 ? `
            <div class="social-results">
              ${friends.map((f) => {
                const pr = this.socialService.getProfile(f);
                const titleLabel = this.getTitle(pr.title);
                return `
                <div class="social-user">
                  <div class="social-user__info">
                    <button class="social-user__name social-user__name--link" type="button" data-action="view-profile" data-user="${f}">${f}</button>
                    <div class="social-user__status">${titleLabel}</div>
                  </div>
                  <button class="btn btn--danger" type="button" data-action="remove-friend" data-user="${f}" style="font-size: 0.72rem; padding: 6px 12px;">Remove</button>
                </div>
              `; }).join("")}
            </div>
          ` : `<p class="social-empty">No friends yet. Search for commanders above!</p>`}
        </div>
      </div>
    `;
  }

  renderProfileView(username) {
    const pr = this.socialService.getProfile(username);
    const avatar = GameShell.AVATARS[pr.avatar] || GameShell.AVATARS[0];
    const banner = GameShell.BANNERS[pr.banner] || GameShell.BANNERS[0];
    const titleLabel = this.getTitle(pr.title);
    const isFriend = this.socialService.getFriends(this.state.currentUser.username).includes(username);
    const avatarHtml = this.getAvatarHtml(pr.customAvatar, pr.avatar);

    return `
      <div class="screen__head">
        <button class="btn btn--ghost" type="button" data-action="close-profile-view">&#8592; Back to Social</button>
      </div>

      <div class="profile-view">
        <div class="profile-banner" style="background: linear-gradient(135deg, ${banner.color}, #0a0505);">
          <div class="profile-banner__avatar">${avatarHtml}</div>
          <div class="profile-banner__info">
            <h2>${username}</h2>
            <p>${titleLabel}</p>
          </div>
        </div>

        ${pr.bio ? `
          <div class="profile-view__bio">
            <span class="profile-view__bio-label">Bio</span>
            <p>${pr.bio}</p>
          </div>
        ` : ""}

        <div class="profile-view__stats">
          <div class="profile-view__stat">
            <span class="profile-view__stat-label">Avatars Unlocked</span>
            <strong>${pr.unlockedAvatars.length}</strong>
          </div>
          <div class="profile-view__stat">
            <span class="profile-view__stat-label">Banners Unlocked</span>
            <strong>${pr.unlockedBanners.length}</strong>
          </div>
          <div class="profile-view__stat">
            <span class="profile-view__stat-label">Titles Unlocked</span>
            <strong>${pr.unlockedTitles.length}</strong>
          </div>
        </div>

        ${!isFriend ? `
          <button class="btn btn--primary btn--wide" type="button" data-action="send-request" data-user="${username}">Add Friend</button>
        ` : `<span class="social-badge social-badge--friend" style="margin-top: 12px;">Friends</span>`}
      </div>
    `;
  }

  /* ─── Settings Screen ───────────────────────────── */
  screenSettings() {
    const s = this.state.settings;
    return `
      <div class="screen__head">
        <p class="screen__tag">Configuration</p>
        <h2>Settings</h2>
        <p>Customize your gameplay experience.</p>
      </div>
      <div class="settings-section">
        <h3 class="settings-section__title">Graphics</h3>
        ${this.toggleRow("particles", "Particles", "Background particle effects", s.particles)}
        ${this.toggleRow("animations", "Animations", "UI transition animations", s.animations)}
        ${this.toggleRow("shadows", "Shadows", "Panel and element shadows", s.shadows)}
        ${this.toggleRow("screenShake", "Screen Shake", "Camera shake on events", s.screenShake)}
        ${this.toggleRow("showFps", "Show FPS", "Display frame counter", s.showFps)}
      </div>
      <div class="settings-section" style="margin-top: 14px;">
        <h3 class="settings-section__title">General</h3>
        <div class="setting-row">
          <div>
            <div class="setting-row__label">Language</div>
            <div class="setting-row__desc">Interface language</div>
          </div>
          <select class="setting-select" data-setting-language>
            ${this.config.supportedLanguages.map(
              (l) => `<option value="${l}" ${s.language === l ? "selected" : ""}>${l.toUpperCase()}</option>`,
            ).join("")}
          </select>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-row__label">Overlay Intensity</div>
            <div class="setting-row__desc">Background effect density</div>
          </div>
          <select class="setting-select" data-setting-overlay>
            <option value="low" ${s.overlayIntensity === "low" ? "selected" : ""}>Low</option>
            <option value="balanced" ${s.overlayIntensity === "balanced" ? "selected" : ""}>Balanced</option>
            <option value="high" ${s.overlayIntensity === "high" ? "selected" : ""}>High</option>
          </select>
        </div>
      </div>
    `;
  }

  toggleRow(key, label, desc, checked) {
    return `
      <div class="setting-row">
        <div>
          <div class="setting-row__label">${label}</div>
          <div class="setting-row__desc">${desc}</div>
        </div>
        <label class="toggle">
          <input type="checkbox" data-setting="${key}" ${checked ? "checked" : ""} />
          <span class="toggle__track"></span>
          <span class="toggle__thumb"></span>
        </label>
      </div>
    `;
  }

  /* ─── Profile Screen ────────────────────────────── */
  screenPersonal(country) {
    const username = this.state.currentUser.username;
    const profile = this.socialService.getProfile(username);
    const banner = GameShell.BANNERS[this.state.selectedBanner] || GameShell.BANNERS[0];
    const titleLabel = this.getTitle(this.state.selectedTitle);

    // Chest cooldown
    const canOpen = this.socialService.canOpenChest(username);
    const cooldownMs = this.socialService.getChestCooldownRemaining(username);
    const cooldownH = Math.floor(cooldownMs / 3600000);
    const cooldownM = Math.floor((cooldownMs % 3600000) / 60000);
    const cooldownS = Math.floor((cooldownMs % 60000) / 1000);
    const cooldownStr = `${String(cooldownH).padStart(2, "0")}:${String(cooldownM).padStart(2, "0")}:${String(cooldownS).padStart(2, "0")}`;

    // Chest result overlay
    const chestResult = this.state.chestResult;

    return `
      ${chestResult ? `
        <div class="chest-result-overlay">
          <div class="chest-result">
            <div class="chest-result__rarity chest-result__rarity--${chestResult.rarity}">${chestResult.rarity.toUpperCase()}</div>
            <div class="chest-result__icon">${chestResult.category === "title" ? "&#127942;" : chestResult.category === "avatar" ? "&#128100;" : "&#127937;"}</div>
            <div class="chest-result__label">${chestResult.reward.label}</div>
            ${chestResult.duplicate ? `<div class="chest-result__dupe">Already owned — better luck next time!</div>` : `<div class="chest-result__new">NEW UNLOCK!</div>`}
            <button class="btn btn--primary" type="button" data-action="close-chest-result">Continue</button>
          </div>
        </div>
      ` : ""}

      <div class="profile-banner" style="background: linear-gradient(135deg, ${banner.color}, #0a0505);">
        <div class="profile-banner__avatar">${this.getAvatarHtml(this.state.customAvatar, this.state.selectedAvatar)}</div>
        <div class="profile-banner__info">
          <h2>${username}</h2>
          <p>${titleLabel} · Joined ${formatDate(this.state.currentUser.createdAt)}</p>
        </div>
      </div>

      <div class="screen__head" style="margin-top: 16px;">
        <p class="screen__tag">Commander Profile</p>
        <h2>Personal</h2>
      </div>

      <!-- Bio -->
      <div class="profile-section">
        <h3 class="profile-section__title">Bio</h3>
        <p class="profile-section__desc">Write a short bio about yourself (max 50 characters).</p>
        <div class="profile-bio">
          <input type="text" data-bio-input maxlength="50" placeholder="Tell the world about yourself…" value="${this.state.bio}" />
          <span class="profile-bio__count">${this.state.bio.length}/50</span>
        </div>
        <button class="btn btn--primary" type="button" data-action="save-bio" style="margin-top: 8px;">Save Bio</button>
        ${this.state.bioError ? `<p class="error-msg" style="margin-top: 8px;">${this.state.bioError}</p>` : ""}
      </div>

      <!-- Title Selector -->
      <div class="profile-section">
        <h3 class="profile-section__title">Title</h3>
        <p class="profile-section__desc">Choose a title to display. Unlock more from chests!</p>
        <div class="title-grid">
          ${TITLES.filter((t) => profile.unlockedTitles.includes(t.id)).map((t) => {
            const selected = this.state.selectedTitle === t.id;
            return `
              <button class="title-item ${selected ? "is-selected" : ""}"
                type="button" data-action="select-title" data-title-id="${t.id}">
                ${t.label}
              </button>
            `;
          }).join("")}
        </div>
      </div>

      <!-- Daily Chest -->
      <div class="profile-section">
        <h3 class="profile-section__title">Daily Free Chest</h3>
        <p class="profile-section__desc">Open a free chest every 12 hours to win cosmetics!</p>
        <div class="chest-section">
          <div class="chest-icon ${canOpen ? "chest-icon--ready" : ""}">&#127873;</div>
          ${canOpen
            ? `<button class="btn btn--accent btn--wide" type="button" data-action="open-chest">Open Chest</button>`
            : `<div class="chest-cooldown"><span class="chest-cooldown__label">Next chest in</span><span class="chest-cooldown__time">${cooldownStr}</span></div>`
          }
          <div class="chest-odds">
            <span class="chest-odds__item chest-odds__item--legendary">Legendary 1%</span>
            <span class="chest-odds__item chest-odds__item--mythic">Mythic 5%</span>
            <span class="chest-odds__item chest-odds__item--epic">Epic 14%</span>
            <span class="chest-odds__item chest-odds__item--rare">Rare 30%</span>
            <span class="chest-odds__item chest-odds__item--common">Common 50%</span>
          </div>
        </div>
      </div>

      <!-- Custom Profile Picture -->
      <div class="profile-section">
        <h3 class="profile-section__title">Custom Profile Picture</h3>
        <p class="profile-section__desc">Upload an image from your computer (max 512 KB).</p>
        <input type="file" id="avatar-upload" accept="image/*" style="display:none" />
        <div class="custom-avatar-row">
          ${this.state.customAvatar ? `
            <div class="custom-avatar-preview">
              <img src="${this.state.customAvatar}" alt="Custom avatar" class="custom-avatar-img custom-avatar-img--preview" />
            </div>
            <div class="custom-avatar-actions">
              <button class="btn btn--primary" type="button" data-action="upload-avatar">Change Picture</button>
              <button class="btn btn--danger" type="button" data-action="remove-custom-avatar">Remove</button>
            </div>
          ` : `
            <button class="btn btn--accent" type="button" data-action="upload-avatar">Choose From Files</button>
          `}
        </div>
        <p class="custom-avatar-note">Allowed: PNG, JPG, WEBP. Files are resized automatically to fit the frame.</p>
      </div>

      <!-- Avatars (only unlocked) -->
      <div class="profile-section">
        <h3 class="profile-section__title">Profile Icons <span class="social-count">${profile.unlockedAvatars.length}/${GameShell.AVATARS.length}</span></h3>
        <p class="profile-section__desc">Or pick an icon. Custom picture takes priority if set.</p>
        <div class="avatar-grid">
          ${GameShell.AVATARS.filter((a) => profile.unlockedAvatars.includes(a.id)).map((a) => {
            const selected = this.state.selectedAvatar === a.id;
            return `
              <button class="avatar-item ${selected ? "is-selected" : ""}"
                type="button" data-action="select-avatar" data-id="${a.id}">
                <span class="avatar-item__icon">${a.icon}</span>
                <span class="avatar-item__label">${a.label}</span>
              </button>
            `;
          }).join("")}
        </div>
      </div>

      <!-- Banners (only unlocked) -->
      <div class="profile-section">
        <h3 class="profile-section__title">Banners <span class="social-count">${profile.unlockedBanners.length}/${GameShell.BANNERS.length}</span></h3>
        <p class="profile-section__desc">Select a banner for your profile. Unlock more from chests!</p>
        <div class="banner-grid">
          ${GameShell.BANNERS.filter((b) => profile.unlockedBanners.includes(b.id)).map((b) => {
            const selected = this.state.selectedBanner === b.id;
            return `
              <button class="banner-item ${selected ? "is-selected" : ""}"
                type="button" data-action="select-banner" data-id="${b.id}"
                style="background: linear-gradient(135deg, ${b.color}, #0a0505);">
                <span class="banner-item__label">${b.label}</span>
              </button>
            `;
          }).join("")}
        </div>
      </div>

      <!-- Stats -->
      <div class="cards" style="margin-top: 16px;">
        <article class="card">
          <span class="card__label">Active Nation</span>
          <strong class="card__value">${country.name}</strong>
          <p>${country.capital} is your command center.</p>
        </article>
        <article class="card">
          <span class="card__label">Security</span>
          <strong class="card__value">Identity Protected</strong>
          <p>Your real identity is hidden from other players.</p>
        </article>
        <article class="card">
          <span class="card__label">Collection</span>
          <strong class="card__value">${profile.unlockedAvatars.length + profile.unlockedBanners.length + profile.unlockedTitles.length} Items</strong>
          <p>Open chests to grow your collection!</p>
        </article>
      </div>
    `;
  }

  screenLabel(s) {
    return { solo: "Solo Mode", multiplayer: "Multiplayer", social: "Social", settings: "Settings", personal: "Profile" }[s] ?? "Command";
  }
}