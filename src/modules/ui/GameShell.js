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
      gamePhase: null,       // null | "picking" | "intro" | "active"
      gameMode: null,        // "solo" | "multiplayer"
      lockedCountries: {},   // { countryCode: playerName }
      pickedCountry: null,   // current player's tentative pick
      pickRegionFilter: "all",
      botCount: 5,
      gameZoom: "world",       // "world" | "country"
      attackTarget: null,      // country code targeted for attack
      introStep: 0,            // current intro animation step
      turnNumber: 1,
      turnPhase: "strategy",   // "strategy" | "battle"
      chatMessages: [],
      turnTimer: 150,
      /* Resource system */
      gold: 50,
      troops: 10,
      farmsUsed: 0,     // farms done this turn (max 3)
      recruiting: false, // animation flag
      troopCounts: {},   // { countryCode: troopCount }
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
        this.state.gamePhase = "intro";
        this.state.introStep = 0;
        this.state.turnNumber = 1;
        this.state.turnTimer = 150;
        this.state.chatMessages = [];
        this.state.gold = 50;
        this.state.troops = 10;
        this.state.farmsUsed = 0;
        // Initial troop distribution
        const troopCounts = {};
        for (const [code] of Object.entries(this.state.lockedCountries)) {
          troopCounts[code] = 5 + Math.floor(Math.random() * 6);
        }
        this.state.troopCounts = troopCounts;
        this.renderView();
        this.startIntro();
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
        this.state.gameZoom = "world";
        this.state.attackTarget = null;
        this.state.introStep = 0;
        this.state.gold = 50;
        this.state.troops = 10;
        this.state.farmsUsed = 0;
        this.state.troopCounts = {};
        this.stopTurnTimer();
        this.renderView();
      }
      if (action === "skip-intro") {
        this.finishIntro();
      }
      if (action === "start-turn") {
        this.state.turnPhase = "battle";
        this.state.farmsUsed = 0;
        // Income per turn
        const pCode = this.worldState.selectedCountryCode;
        const pCountry = this.worldState.countries.find((co) => co.code === pCode);
        const income = 10 + Math.floor((pCountry?.economyScore ?? 50) / 10);
        this.state.gold += income;
        this.state.chatMessages = [`\u2694 Turn ${this.state.turnNumber}: +${income} gold income`, ...this.state.chatMessages].slice(0, 30);
        this.renderView();
      }
      if (action === "farm-resources") {
        if (this.state.farmsUsed < 3 && this.state.turnPhase === "battle") {
          const yield_ = 8 + Math.floor(Math.random() * 12);
          this.state.gold += yield_;
          this.state.farmsUsed++;
          this.state.chatMessages = [`\u2618 Farmed ${yield_} gold (${3 - this.state.farmsUsed} farms left)`, ...this.state.chatMessages].slice(0, 30);
          this.renderView();
        }
      }
      if (action === "recruit-troops") {
        const cost = 15;
        if (this.state.gold >= cost) {
          const count = 2 + Math.floor(Math.random() * 3);
          this.state.gold -= cost;
          this.state.troops += count;
          const myCode = this.worldState.selectedCountryCode;
          this.state.troopCounts[myCode] = (this.state.troopCounts[myCode] || 0) + count;
          this.state.chatMessages = [`\u2694 Recruited ${count} troops for ${cost} gold`, ...this.state.chatMessages].slice(0, 30);
          this.renderView();
        }
      }
      if (action === "fortify-nation") {
        const cost = 20;
        if (this.state.gold >= cost) {
          this.state.gold -= cost;
          const myCode = this.worldState.selectedCountryCode;
          this.state.troopCounts[myCode] = (this.state.troopCounts[myCode] || 0) + 3;
          this.state.chatMessages = [`\u26E8 Fortified defenses! +3 garrison troops`, ...this.state.chatMessages].slice(0, 30);
          this.renderView();
        }
      }
      if (action === "zoom-to-world") {
        this.state.gameZoom = "world";
        this.renderView();
      }
      if (action === "set-attack-target") {
        const code = act.dataset.code;
        if (code === this.worldState.selectedCountryCode) {
          this.state.gameZoom = "country";
          this.state.attackTarget = null;
        } else {
          this.state.attackTarget = this.state.attackTarget === code ? null : code;
        }
        this.renderView();
      }
      if (action === "confirm-attack") {
        const countries = this.worldState.countries;
        const playerCode = this.worldState.selectedCountryCode;
        const player = countries.find((co) => co.code === playerCode);
        const targetCode = act.dataset.code;
        const target = countries.find((co) => co.code === targetCode);
        if (player && target) {
          const myTroops = this.state.troopCounts[playerCode] || 5;
          const enemyTroops = this.state.troopCounts[targetCode] || 5;
          const milBonus = (player.militaryScore - target.militaryScore) / 100;
          const troopRatio = myTroops / Math.max(1, enemyTroops);
          const odds = Math.min(92, Math.max(8, Math.round(50 * troopRatio + milBonus * 20)));
          const won = Math.random() * 100 < odds;
          // Losses
          const atkLoss = 1 + Math.floor(Math.random() * 3);
          const defLoss = 1 + Math.floor(Math.random() * 4);
          this.state.troopCounts[playerCode] = Math.max(1, myTroops - atkLoss);
          this.state.troopCounts[targetCode] = Math.max(0, enemyTroops - defLoss);
          if (won) {
            const userName = this.state.currentUser?.username ?? "Player";
            this.state.lockedCountries[targetCode] = userName;
            this.state.troopCounts[targetCode] = Math.max(1, Math.floor(atkLoss));
            this.state.chatMessages = [
              `\u2694 VICTORY! ${player.name} conquered ${target.name}! (-${atkLoss} troops)`,
              ...this.state.chatMessages
            ].slice(0, 30);
          } else {
            this.state.chatMessages = [
              `\u{1F525} REPELLED! ${player.name} failed to take ${target.name} (-${atkLoss} troops)`,
              ...this.state.chatMessages
            ].slice(0, 30);
          }
        }
        this.state.attackTarget = null;
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

    // Fullscreen game modes bypass the normal shell
    if (this.state.gamePhase === "intro" || this.state.gamePhase === "active") {
      if (this.state.activeScreen === "personal" && this.state.currentUser) {
        this.stopChestTimer();
      }
      this.root.innerHTML = `<div class="game-root ${this.state.settings.animations ? "" : "no-motion"}">${this.renderBackground()}<div class="game-fullscreen">${this.state.gamePhase === "intro" ? this.renderIntro() : this.screenGameActive()}</div></div>`;
      return;
    }

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

  /* ─── Cinematic Intro Methods ───────────────────── */
  startIntro() {
    const participants = Object.entries(this.state.lockedCountries);
    const total = participants.length + 1; // each player + final "PREPARE FOR WAR"
    this.state.introStep = 0;
    this.renderView();
    const advance = () => {
      this.state.introStep++;
      this.renderView();
      if (this.state.introStep < total) {
        const isLast = this.state.introStep === total - 1;
        this._introTimer = setTimeout(advance, isLast ? 999999 : 2600);
      }
    };
    this._introTimer = setTimeout(advance, 1200);
  }

  finishIntro() {
    clearTimeout(this._introTimer);
    this.state.gamePhase = "active";
    this.state.gameZoom = "world";
    this.renderView();
    this.startTurnTimer();
  }

  renderIntro() {
    const countries = this.worldState.countries;
    const participants = Object.entries(this.state.lockedCountries);
    const username = this.state.currentUser?.username ?? "Player";
    const step = this.state.introStep;
    const isLastStep = step >= participants.length;
    const troopCounts = this.state.troopCounts;

    // Build the preview strip of all nations (mini flags at top)
    const flagStrip = participants.map(([code, name], i) => {
      const done = i < step;
      const active = i === step;
      return `<span class="intro-strip__flag ${done ? "intro-strip__flag--done" : ""} ${active ? "intro-strip__flag--active" : ""}">${this.getFlag(code)}</span>`;
    }).join("");

    if (isLastStep) {
      return `
        <div class="intro-stage intro-stage--final">
          <div class="intro-strip">${flagStrip}</div>
          <div class="intro-final">
            <div class="intro-final__tagline">THE DESTINY OF POWER</div>
            <div class="intro-final__separator"></div>
            <h1 class="intro-final__title">PREPARE FOR WAR</h1>
            <p class="intro-final__desc">${participants.length} nations. One world. No mercy.</p>
            <div class="intro-final__stats-row">
              <div class="intro-final__stat"><strong>${participants.length}</strong><span>Nations</span></div>
              <div class="intro-final__stat"><strong>${Object.values(troopCounts).reduce((a,b) => a+b, 0)}</strong><span>Total Troops</span></div>
              <div class="intro-final__stat"><strong>${this.state.gold}</strong><span>Starting Gold</span></div>
            </div>
            <button class="intro-start-btn" type="button" data-action="skip-intro">&#9876; ENTER THE BATTLEFIELD &#10132;</button>
          </div>
          <button class="intro-skip" type="button" data-action="skip-intro">Skip &#10132;</button>
        </div>
      `;
    }

    const [code, name] = participants[step];
    const co = countries.find((c) => c.code === code);
    const isPlayer = name === username;
    const troops = troopCounts[code] || 5;
    const threatLvl = (co?.militaryScore ?? 50) >= 70 ? "HIGH" : (co?.militaryScore ?? 50) >= 40 ? "MEDIUM" : "LOW";

    return `
      <div class="intro-stage" style="--card-accent:${co?.color ?? '#888'}">
        <div class="intro-strip">${flagStrip}</div>
        <div class="intro-step-count">${step + 1} / ${participants.length}</div>

        <div class="intro-reveal">
          <div class="intro-reveal__bg" style="background: radial-gradient(circle at 50% 50%, ${co?.color ?? '#333'}33 0%, transparent 70%)"></div>

          <div class="intro-card ${isPlayer ? "intro-card--player" : "intro-card--bot"}" style="--card-color:${co?.color ?? '#666'}">
            <div class="intro-card__top-strip">
              <span class="intro-card__role-badge">${isPlayer ? "&#9733; YOUR NATION" : `OPPONENT ${step + 1}`}</span>
              <span class="intro-card__threat">THREAT: ${isPlayer ? "—" : threatLvl}</span>
            </div>

            <div class="intro-card__flag">${this.getFlag(code)}</div>

            <h1 class="intro-card__country">${co?.name ?? code}</h1>
            <p class="intro-card__player">${isPlayer ? `Commander ${name}` : name}</p>
            <p class="intro-card__capital">&#9670; Capital: ${co?.capital ?? "Unknown"}</p>

            <div class="intro-card__divider"></div>

            <div class="intro-card__stats">
              <div class="intro-stat">
                <span class="intro-stat__icon">&#128176;</span>
                <div class="intro-stat__info"><span class="intro-stat__lbl">ECONOMY</span><strong class="intro-stat__val">${co?.economyScore ?? 0}</strong></div>
                <div class="intro-stat__bar"><div class="intro-stat__fill intro-stat__fill--eco" style="width:${co?.economyScore ?? 0}%"></div></div>
              </div>
              <div class="intro-stat">
                <span class="intro-stat__icon">&#9876;</span>
                <div class="intro-stat__info"><span class="intro-stat__lbl">MILITARY</span><strong class="intro-stat__val">${co?.militaryScore ?? 0}</strong></div>
                <div class="intro-stat__bar"><div class="intro-stat__fill intro-stat__fill--mil" style="width:${co?.militaryScore ?? 0}%"></div></div>
              </div>
              <div class="intro-stat">
                <span class="intro-stat__icon">&#127963;</span>
                <div class="intro-stat__info"><span class="intro-stat__lbl">STABILITY</span><strong class="intro-stat__val">${co?.stabilityScore ?? 0}</strong></div>
                <div class="intro-stat__bar"><div class="intro-stat__fill intro-stat__fill--stb" style="width:${co?.stabilityScore ?? 0}%"></div></div>
              </div>
            </div>

            <div class="intro-card__troops">
              <span class="intro-card__troops-icon">&#9816;</span>
              <span class="intro-card__troops-count">${troops}</span>
              <span class="intro-card__troops-label">Starting Troops</span>
            </div>
          </div>
        </div>

        <button class="intro-skip" type="button" data-action="skip-intro">Skip &#10132;</button>
      </div>
    `;
  }

  startTurnTimer() {
    clearInterval(this._turnInterval);
    this._turnInterval = setInterval(() => {
      this.state.turnTimer--;
      if (this.state.turnTimer <= 0) {
        this.state.turnTimer = 150;
        this.state.turnNumber++;
        this.state.turnPhase = "strategy";
        this.state.farmsUsed = 0;
        // Bot AI: each bot gets resources & may attack
        const c = this.worldState.countries;
        const locked = this.state.lockedCountries;
        const username = this.state.currentUser?.username ?? "Player";
        const bots = Object.entries(locked).filter(([, name]) => name.startsWith("Bot "));
        for (const [botCode, botName] of bots) {
          // Bots earn income & recruit
          this.state.troopCounts[botCode] = (this.state.troopCounts[botCode] || 5) + 2;
          // Try to attack a random enemy
          const targets = Object.entries(locked).filter(([code, name]) => code !== botCode && name !== botName);
          if (targets.length > 0 && Math.random() < 0.6) {
            const [defCode, defOwner] = targets[Math.floor(Math.random() * targets.length)];
            const atk = c.find((co) => co.code === botCode);
            const def = c.find((co) => co.code === defCode);
            const atkTroops = this.state.troopCounts[botCode] || 5;
            const defTroops = this.state.troopCounts[defCode] || 5;
            const won = Math.random() < (atkTroops / (atkTroops + defTroops));
            this.state.troopCounts[botCode] = Math.max(1, atkTroops - 1 - Math.floor(Math.random() * 2));
            this.state.troopCounts[defCode] = Math.max(0, defTroops - 1 - Math.floor(Math.random() * 2));
            if (won && atk && def) {
              this.state.lockedCountries[defCode] = botName;
              this.state.troopCounts[defCode] = 1 + Math.floor(Math.random() * 2);
              this.state.chatMessages = [
                `\u2694 ${atk.name} (${botName}) conquered ${def.name}!`,
                ...this.state.chatMessages,
              ].slice(0, 30);
            } else if (atk && def) {
              this.state.chatMessages = [
                `\u{1F6E1} ${def.name} repelled ${atk.name}'s attack`,
                ...this.state.chatMessages,
              ].slice(0, 30);
            }
          }
        }
        // Check win/loss
        const playerTerritories = Object.entries(locked).filter(([, n]) => n === username);
        const totalTerritories = Object.keys(locked).length;
        if (playerTerritories.length === 0) {
          this.state.chatMessages = ["\u{1F480} DEFEAT — You have been eliminated!", ...this.state.chatMessages];
          this.stopTurnTimer();
        } else if (playerTerritories.length === totalTerritories) {
          this.state.chatMessages = ["\u{1F451} VICTORY — You conquered the entire world!", ...this.state.chatMessages];
          this.stopTurnTimer();
        }
      }
      // Update timer display without full re-render
      const el = this.root.querySelector("[data-turn-timer]");
      const phaseEl = this.root.querySelector("[data-turn-phase]");
      if (el) el.textContent = this.formatTimer(this.state.turnTimer);
      if (phaseEl) phaseEl.textContent = `Turn ${this.state.turnNumber}`;
    }, 1000);
  }

  stopTurnTimer() {
    clearInterval(this._turnInterval);
  }

  formatTimer(s) {
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
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
          <div class="solo-nation-preview">
            <span class="solo-flag">${this.getFlag(c.code)}</span>
            <div>
              <span class="card__label">Selected Nation</span>
              <strong class="card__value">${c.name}</strong>
              <p>Capital: ${c.capital}</p>
            </div>
          </div>
          <button class="btn btn--primary btn--wide" type="button" data-action="enter-solo">&#9876; Choose Nation &amp; Enter Match</button>
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
                <div class="country-card__swatch" style="background:${co.color}">
                  <span class="country-card__flag-emoji">${this.getFlag(co.code)}</span>
                </div>
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

  /* ─── Active Game Screen — Tactical Map ────────── */
  screenGameActive() {
    const countries = this.worldState.countries;
    const playerCode = this.worldState.selectedCountryCode;
    const player = countries.find((co) => co.code === playerCode) ?? countries[0];
    const locked = this.state.lockedCountries;
    const username = this.state.currentUser?.username ?? "Player";
    const posMap = this.getCountryPositions();
    const attackTarget = this.state.attackTarget;
    const targetData = attackTarget ? countries.find((co) => co.code === attackTarget) : null;
    const turnNumber = this.state.turnNumber;
    const turnPhase = this.state.turnPhase;
    const chatMessages = this.state.chatMessages;
    const turnTimer = this.state.turnTimer;
    const gold = this.state.gold;
    const troops = this.state.troops;
    const farmsUsed = this.state.farmsUsed;
    const troopCounts = this.state.troopCounts;

    // Odds (troop-based)
    const myTroops = troopCounts[playerCode] || 5;
    const enemyTroops = attackTarget ? (troopCounts[attackTarget] || 5) : 0;
    const winOdds = targetData
      ? Math.min(92, Math.max(8, Math.round(50 * (myTroops / Math.max(1, enemyTroops)) + (player.militaryScore - targetData.militaryScore) / 5)))
      : 0;

    // Participants
    const participants = Object.entries(locked).map(([code, name]) => {
      const co = countries.find((c) => c.code === code);
      const isPlayer = name === username;
      return { code, name, co, isPlayer };
    });

    // SVG world map with continent outlines (dark tactical style)
    const worldSvg = `<svg class="tac-worldmap-svg" viewBox="0 0 1000 500" xmlns="http://www.w3.org/2000/svg">
      <!-- Water -->
      <rect fill="#0a1628" width="1000" height="500"/>
      <!-- Continents (simplified shapes) -->
      <g fill="#0f2318" stroke="#1a3d2a" stroke-width="0.8" opacity="0.9">
        <!-- North America -->
        <path d="M50,40 L140,30 L200,55 L240,80 L260,120 L230,160 L210,200 L170,220 L140,200 L100,190 L80,170 L90,210 L75,230 L110,240 L120,270 L110,260 L80,280 L60,260 L50,200 L40,160 L30,120 L35,80 Z"/>
        <!-- Greenland -->
        <path d="M260,20 L320,15 L345,30 L340,60 L310,65 L280,50 L265,35 Z"/>
        <!-- South America -->
        <path d="M175,280 L200,270 L230,275 L260,295 L280,320 L300,355 L310,400 L300,440 L280,460 L250,470 L230,455 L220,430 L210,400 L195,370 L180,340 L170,310 L165,295 Z"/>
        <!-- Europe -->
        <path d="M410,50 L440,45 L470,55 L510,50 L540,60 L530,80 L540,100 L520,110 L500,105 L480,115 L460,110 L450,120 L430,115 L420,100 L410,80 Z"/>
        <!-- Africa -->
        <path d="M420,160 L455,150 L490,155 L520,170 L540,200 L555,240 L560,280 L550,320 L535,360 L515,390 L490,400 L460,390 L440,370 L430,340 L425,300 L420,260 L415,220 L410,190 Z"/>
        <!-- Middle East -->
        <path d="M530,115 L570,110 L600,120 L620,140 L610,165 L585,175 L560,170 L540,155 L530,135 Z"/>
        <!-- Russia / Eurasia -->
        <path d="M540,25 L600,20 L680,25 L750,30 L820,38 L850,45 L840,65 L800,75 L760,70 L720,60 L680,65 L640,60 L600,65 L570,55 L555,45 Z"/>
        <!-- South Asia -->
        <path d="M620,170 L660,160 L690,180 L700,210 L685,240 L660,250 L640,235 L625,210 L615,190 Z"/>
        <!-- East Asia -->
        <path d="M700,60 L750,55 L790,70 L820,90 L830,120 L810,150 L780,160 L750,155 L730,140 L720,120 L710,95 L700,75 Z"/>
        <!-- Southeast Asia / Indonesia -->
        <path d="M720,220 L750,215 L780,225 L800,240 L810,260 L795,270 L770,265 L745,255 L730,240 Z"/>
        <!-- Japan -->
        <path d="M840,85 L855,80 L862,95 L855,115 L845,120 L836,105 Z"/>
        <!-- Australia -->
        <path d="M760,340 L810,330 L860,340 L880,370 L875,400 L850,420 L810,425 L775,410 L755,385 L750,360 Z"/>
        <!-- New Zealand -->
        <path d="M890,410 L900,405 L905,425 L895,435 L885,425 Z"/>
      </g>
      <!-- Grid lines -->
      <g stroke="#1a3d2a" stroke-width="0.3" opacity="0.3">
        <line x1="0" y1="250" x2="1000" y2="250"/>
        <line x1="500" y1="0" x2="500" y2="500"/>
        <line x1="0" y1="125" x2="1000" y2="125"/>
        <line x1="0" y1="375" x2="1000" y2="375"/>
        <line x1="250" y1="0" x2="250" y2="500"/>
        <line x1="750" y1="0" x2="750" y2="500"/>
      </g>
    </svg>`;

    // Map territory nodes with troop counts
    const mapNodes = participants.map(({ code, name, co, isPlayer }) => {
      const pos = posMap[code];
      if (!co || !pos) return "";
      const isTarget = code === attackTarget;
      let cls = "tac-node";
      if (isPlayer) cls += " tac-node--player";
      else if (name.startsWith("Bot ")) cls += " tac-node--bot";
      else cls += " tac-node--enemy";
      if (isTarget) cls += " tac-node--target";
      const nodeColor = isPlayer ? (player.color || "#4ade80") : (co.color ?? "#94a3b8");
      const nodeTroops = troopCounts[code] || 0;
      return `
        <button class="${cls}" type="button"
          data-action="set-attack-target" data-code="${code}"
          style="left:${pos.x}%;top:${pos.y}%;--nc:${nodeColor}"
          title="${co.name}${isPlayer ? " (YOU)" : ` — ${name}`} | Troops: ${nodeTroops}">
          <div class="tac-node__blob"></div>
          <span class="tac-node__flag">${this.getFlag(code)}</span>
          <span class="tac-node__troops">${nodeTroops}</span>
          <span class="tac-node__lbl">${co.name}</span>
          ${isPlayer ? `<span class="tac-node__star">\u2605</span>` : ""}
          ${isTarget ? `<span class="tac-node__crosshair">\u2295</span>` : ""}
        </button>
      `;
    }).join("");

    // Battle log
    const chatHtml = chatMessages.length
      ? chatMessages.slice(0, 15).map((m) => `<div class="tac-log__msg">${m}</div>`).join("")
      : `<div class="tac-log__msg tac-log__msg--hint">No battles yet...</div>`;

    // Participants sidebar
    const playerRows = participants.map(({ code, name, co, isPlayer }) => {
      const tCount = troopCounts[code] || 0;
      return `
        <div class="tac-player-row${isPlayer ? " tac-player-row--you" : ""}">
          <span class="tac-player-row__flag">${this.getFlag(code)}</span>
          <div class="tac-player-row__info">
            <span class="tac-player-row__name">${isPlayer ? "You" : name}</span>
            <span class="tac-player-row__territory">${co?.name ?? code}</span>
          </div>
          <span class="tac-player-row__troops">${tCount} \u2694</span>
        </div>
      `;
    }).join("");

    // Count player territories
    const myTerritories = participants.filter((p) => p.isPlayer).length;
    const totalT = participants.length;

    const phaseLabel = turnPhase === "battle" ? "BATTLE PHASE" : "STRATEGY PHASE";
    const phaseHint  = turnPhase === "battle"
      ? "Attack enemies, farm resources, recruit troops"
      : "Click 'Start Turn' to begin";
    const canFarm = turnPhase === "battle" && farmsUsed < 3;
    const canRecruit = gold >= 15;
    const canFortify = gold >= 20;

    return `
      <div class="tac-wrap">

        <!-- ── TOP BAR ────────────────────────────── -->
        <div class="tac-topbar">
          <div class="tac-topbar__left">
            <span class="tac-flag-badge">${this.getFlag(playerCode)}</span>
            <div class="tac-player-info">
              <div class="tac-player-info__name">${username}</div>
              <div class="tac-player-info__nation">${player.name}</div>
            </div>
          </div>
          <div class="tac-topbar__center">
            <div class="tac-phase-banner tac-phase-banner--${turnPhase}">
              <span class="tac-phase-banner__label">${phaseLabel}</span>
              <span class="tac-phase-banner__hint">${phaseHint}</span>
            </div>
            <div class="tac-turn-badge">Turn ${turnNumber} \u2022 ${myTerritories}/${totalT} territories</div>
          </div>
          <div class="tac-topbar__right">
            <button class="tac-surrender-btn" type="button" data-action="surrender">\u2691 Surrender</button>
          </div>
        </div>

        <!-- ── MAIN AREA ──────────────────────────── -->
        <div class="tac-main">

          <!-- Left panel: stats + resource actions + battle log -->
          <div class="tac-side tac-side--left">
            <div class="tac-stat-card">
              <div class="tac-stat-card__header">\u2694 YOUR NATION</div>
              <div class="tac-stat-card__flag">${this.getFlag(playerCode)}</div>
              <div class="tac-stat-card__name">${player.name}</div>
              <div class="tac-stat-card__capital">\u25C6 ${player.capital}</div>
              <div class="tac-mini-stats">
                <div class="tac-mini-stat">
                  <span class="tac-mini-stat__lbl">ECO</span>
                  <div class="tac-mini-bar"><div class="tac-mini-bar__fill tac-mini-bar__fill--eco" style="width:${player.economyScore}%"></div></div>
                  <span class="tac-mini-stat__val">${player.economyScore}</span>
                </div>
                <div class="tac-mini-stat">
                  <span class="tac-mini-stat__lbl">MIL</span>
                  <div class="tac-mini-bar"><div class="tac-mini-bar__fill tac-mini-bar__fill--mil" style="width:${player.militaryScore}%"></div></div>
                  <span class="tac-mini-stat__val">${player.militaryScore}</span>
                </div>
                <div class="tac-mini-stat">
                  <span class="tac-mini-stat__lbl">STB</span>
                  <div class="tac-mini-bar"><div class="tac-mini-bar__fill tac-mini-bar__fill--stb" style="width:${player.stabilityScore}%"></div></div>
                  <span class="tac-mini-stat__val">${player.stabilityScore}</span>
                </div>
              </div>
            </div>

            <!-- Resource Panel -->
            <div class="tac-resource-panel">
              <div class="tac-resource-panel__header">\u2618 RESOURCES</div>
              <div class="tac-res-rows">
                <div class="tac-res-row"><span class="tac-res-row__icon">\u{1F4B0}</span><span class="tac-res-row__lbl">Gold</span><strong class="tac-res-row__val">${gold}</strong></div>
                <div class="tac-res-row"><span class="tac-res-row__icon">\u2694</span><span class="tac-res-row__lbl">Troops</span><strong class="tac-res-row__val">${troopCounts[playerCode] || 0}</strong></div>
                <div class="tac-res-row"><span class="tac-res-row__icon">\u{1F33E}</span><span class="tac-res-row__lbl">Farms</span><strong class="tac-res-row__val">${3 - farmsUsed}/3</strong></div>
              </div>
              <div class="tac-action-btns">
                <button class="tac-action-btn tac-action-btn--farm" type="button" data-action="farm-resources" ${!canFarm ? "disabled" : ""}>\u{1F33E} Farm (+gold)</button>
                <button class="tac-action-btn tac-action-btn--recruit" type="button" data-action="recruit-troops" ${!canRecruit ? "disabled" : ""}>\u2694 Recruit (15g)</button>
                <button class="tac-action-btn tac-action-btn--fortify" type="button" data-action="fortify-nation" ${!canFortify ? "disabled" : ""}>\u26E8 Fortify (20g)</button>
              </div>
            </div>

            <div class="tac-log">
              <div class="tac-log__header">\u{1F4DC} Battle Log</div>
              <div class="tac-log__body">${chatHtml}</div>
            </div>
          </div>

          <!-- Center: world map -->
          <div class="tac-map-area">
            <div class="tac-map-bg">
              ${worldSvg}
              <div class="tac-map__scanlines"></div>
              ${mapNodes}
            </div>
            <div class="tac-map-legend">
              <span class="tac-legend-pip tac-legend-pip--you"></span><span>You</span>
              <span class="tac-legend-pip tac-legend-pip--bot"></span><span>Bot</span>
              <span class="tac-legend-pip tac-legend-pip--enemy"></span><span>Enemy</span>
            </div>
          </div>

          <!-- Right panel: players -->
          <div class="tac-side tac-side--right">
            <div class="tac-players-panel">
              <div class="tac-players-panel__header">\u2694 NATIONS IN PLAY</div>
              ${playerRows}
            </div>
          </div>

        </div>

        <!-- ── ATTACK PANEL ───────────────────────── -->
        ${targetData && locked[attackTarget] !== username ? `
          <div class="tac-attack-panel">
            <div class="tac-attack-panel__combatants">
              <div class="tac-atk-side tac-atk-side--you">
                <span class="tac-atk-flag">${this.getFlag(playerCode)}</span>
                <div class="tac-atk-name">${player.name}</div>
                <div class="tac-atk-stat">\u2694 ${myTroops} troops</div>
              </div>
              <div class="tac-atk-vs">VS</div>
              <div class="tac-atk-side tac-atk-side--enemy">
                <span class="tac-atk-flag">${this.getFlag(attackTarget)}</span>
                <div class="tac-atk-name">${targetData.name}</div>
                <div class="tac-atk-stat">\u{1F6E1} ${enemyTroops} troops</div>
              </div>
            </div>
            <div class="tac-atk-odds-row">
              <span class="tac-atk-odds-lbl">Victory Odds</span>
              <div class="tac-atk-odds-bar"><div class="tac-atk-odds-fill" style="width:${winOdds}%"></div></div>
              <span class="tac-atk-odds-pct">${winOdds}%</span>
            </div>
            <div class="tac-atk-btns">
              <button class="tac-atk-btn tac-atk-btn--launch" type="button" data-action="confirm-attack" data-code="${attackTarget}">\u2694 Launch Attack</button>
              <button class="tac-atk-btn tac-atk-btn--cancel" type="button" data-action="set-attack-target" data-code="${attackTarget}">Cancel</button>
            </div>
          </div>
        ` : ""}

        <!-- ── BOTTOM BAR ─────────────────────────── -->
        <div class="tac-bottombar">
          <div class="tac-bottombar__left">
            <span class="tac-res-icon">\u{1F4B0}</span>
            <span class="tac-res-val">${gold}</span>
            <span class="tac-res-lbl">gold</span>
            <span class="tac-res-divider">\u2022</span>
            <span class="tac-res-icon">\u2694</span>
            <span class="tac-res-val">${troopCounts[playerCode] || 0}</span>
            <span class="tac-res-lbl">troops</span>
          </div>
          <div class="tac-bottombar__center">
            <span class="tac-turn-lbl">Turn ${turnNumber}</span>
            <span class="tac-timer" data-turn-timer>${this.formatTimer(turnTimer)}</span>
          </div>
          <div class="tac-bottombar__right">
            <button class="tac-start-btn" type="button" data-action="start-turn"
              ${turnPhase === "battle" ? "disabled" : ""}>
              \u25B6 START TURN
            </button>
          </div>
        </div>

      </div>
    `;
  }

  getFlag(code) {
    return [...(code ?? "").toUpperCase()].map((c) =>
      String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65),
    ).join("");
  }

  getCountryPositions() {
    return {
      US:{x:22,y:36}, CA:{x:19,y:22}, MX:{x:18,y:42},
      BR:{x:29,y:58}, AR:{x:26,y:71}, CO:{x:22,y:50},
      VE:{x:25,y:47}, PE:{x:22,y:57},
      GB:{x:44,y:25}, FR:{x:46,y:28}, DE:{x:48,y:25},
      IT:{x:49,y:30}, ES:{x:44,y:31}, PL:{x:51,y:24},
      UA:{x:54,y:25}, SE:{x:50,y:19}, TR:{x:55,y:31},
      RU:{x:67,y:20},
      SA:{x:57,y:39}, IR:{x:60,y:31},
      NG:{x:47,y:48}, EG:{x:53,y:36}, ZA:{x:51,y:67},
      ET:{x:56,y:48}, CD:{x:50,y:53},
      CN:{x:75,y:30}, IN:{x:67,y:39}, JP:{x:82,y:29},
      KR:{x:80,y:30}, PK:{x:64,y:34}, ID:{x:77,y:53},
      KZ:{x:63,y:25}, AU:{x:79,y:63},
    };
  }

  cmdStatBar(label, score, color) {
    return `
      <div class="cmd-stat">
        <div class="cmd-stat__head"><span>${label}</span><strong>${score}</strong></div>
        <div class="cmd-stat__bar">
          <div class="cmd-stat__fill" style="width:${Math.min(100, score)}%;background:${color}"></div>
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