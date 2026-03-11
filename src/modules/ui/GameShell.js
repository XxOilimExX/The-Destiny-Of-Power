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
      turnTimer: 120,
      /* Nation data — per-nation object: { gold, groundTroops, airTroops, groundDef, airDef, farmLvl, farmsUsed } */
      nationData: {},  // { countryCode: { ... } }
      /* Chat system */
      publicChat: [],        // global visible messages
      privateChats: {},      // { countryCode: [messages] } — negotiation
      chatInput: "",
      privateChatTarget: null, // country code of private chat partner
      activeTab: "army",     // "army" | "homeland" | "farm" | "chat"
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
        this.state.turnTimer = 120;
        this.state.publicChat = [];
        this.state.privateChats = {};
        this.state.privateChatTarget = null;
        this.state.chatInput = "";
        this.state.activeTab = "army";
        // Initialize nation data for all participants
        const nd = {};
        for (const [code] of Object.entries(this.state.lockedCountries)) {
          const co = this.worldState.countries.find((c) => c.code === code);
          nd[code] = {
            gold: 100,
            groundTroops: 8 + Math.floor((co?.militaryScore ?? 50) / 15),
            airTroops: 2 + Math.floor((co?.militaryScore ?? 50) / 30),
            groundDef: 5 + Math.floor((co?.stabilityScore ?? 50) / 15),
            airDef: 2 + Math.floor((co?.stabilityScore ?? 50) / 25),
            farmLvl: 1,
            farmsUsed: 0,
          };
        }
        this.state.nationData = nd;
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
        this.state.nationData = {};
        this.state.publicChat = [];
        this.state.privateChats = {};
        this.state.privateChatTarget = null;
        this.state.chatInput = "";
        this.state.activeTab = "army";
        this.stopTurnTimer();
        this.renderView();
      }
      if (action === "skip-intro") {
        this.finishIntro();
      }
      if (action === "start-turn") {
        this.state.turnPhase = "battle";
        const pCode = this.worldState.selectedCountryCode;
        const nd = this.state.nationData[pCode];
        if (nd) {
          nd.farmsUsed = 0;
          const co = this.worldState.countries.find((c) => c.code === pCode);
          const income = 15 + Math.floor((co?.economyScore ?? 50) / 8) + nd.farmLvl * 5;
          nd.gold += income;
          this.state.publicChat = [`\u2694 Turn ${this.state.turnNumber}: ${co?.name ?? pCode} receives +${income} gold`, ...this.state.publicChat].slice(0, 50);
        }
        this.renderView();
      }
      if (action === "farm-resources") {
        const pCode = this.worldState.selectedCountryCode;
        const nd = this.state.nationData[pCode];
        if (nd && nd.farmsUsed < (1 + nd.farmLvl) && this.state.turnPhase === "battle") {
          const yield_ = 10 + nd.farmLvl * 5 + Math.floor(Math.random() * 10);
          nd.gold += yield_;
          nd.farmsUsed++;
          const maxFarms = 1 + nd.farmLvl;
          this.state.publicChat = [`\u2618 Farmed ${yield_} gold (${maxFarms - nd.farmsUsed}/${maxFarms} remaining)`, ...this.state.publicChat].slice(0, 50);
          this.renderView();
        }
      }
      if (action === "upgrade-farm") {
        const pCode = this.worldState.selectedCountryCode;
        const nd = this.state.nationData[pCode];
        if (!nd) return;
        const cost = 40 + nd.farmLvl * 20;
        if (nd.gold >= cost) {
          nd.gold -= cost;
          nd.farmLvl++;
          this.state.publicChat = [`\u{1F33E} Farm upgraded to level ${nd.farmLvl}! More income per harvest`, ...this.state.publicChat].slice(0, 50);
          this.renderView();
        }
      }
      if (action === "buy-ground-troops") {
        const pCode = this.worldState.selectedCountryCode;
        const nd = this.state.nationData[pCode];
        if (nd && nd.gold >= 20) {
          const count = 2 + Math.floor(Math.random() * 3);
          nd.gold -= 20;
          nd.groundTroops += count;
          this.state.publicChat = [`\u{1F6E1} Recruited ${count} ground troops (-20g)`, ...this.state.publicChat].slice(0, 50);
          this.renderView();
        }
      }
      if (action === "buy-air-troops") {
        const pCode = this.worldState.selectedCountryCode;
        const nd = this.state.nationData[pCode];
        if (nd && nd.gold >= 35) {
          const count = 1 + Math.floor(Math.random() * 2);
          nd.gold -= 35;
          nd.airTroops += count;
          this.state.publicChat = [`\u2708 Acquired ${count} air units (-35g)`, ...this.state.publicChat].slice(0, 50);
          this.renderView();
        }
      }
      if (action === "buy-ground-def") {
        const pCode = this.worldState.selectedCountryCode;
        const nd = this.state.nationData[pCode];
        if (nd && nd.gold >= 25) {
          nd.gold -= 25;
          nd.groundDef += 3;
          this.state.publicChat = [`\u26E8 Ground defenses reinforced +3 (-25g)`, ...this.state.publicChat].slice(0, 50);
          this.renderView();
        }
      }
      if (action === "buy-air-def") {
        const pCode = this.worldState.selectedCountryCode;
        const nd = this.state.nationData[pCode];
        if (nd && nd.gold >= 30) {
          nd.gold -= 30;
          nd.airDef += 2;
          this.state.publicChat = [`\u{1F6E1} Anti-air defenses +2 (-30g)`, ...this.state.publicChat].slice(0, 50);
          this.renderView();
        }
      }
      if (action === "set-tab") {
        this.state.activeTab = act.dataset.tab;
        this.renderView();
      }
      if (action === "open-negotiate") {
        const code = act.dataset.code;
        this.state.privateChatTarget = code;
        if (!this.state.privateChats[code]) this.state.privateChats[code] = [];
        this.state.activeTab = "chat";
        this.renderView();
      }
      if (action === "close-negotiate") {
        this.state.privateChatTarget = null;
        this.renderView();
      }
      if (action === "send-public-chat") {
        const input = this.root.querySelector("[data-public-chat-input]");
        const msg = (input?.value ?? "").trim().slice(0, 120);
        if (msg) {
          const pCode = this.worldState.selectedCountryCode;
          const co = this.worldState.countries.find((c) => c.code === pCode);
          this.state.publicChat = [`${this.getFlag(pCode)} ${co?.name ?? "You"}: ${msg}`, ...this.state.publicChat].slice(0, 50);
          this.renderView();
        }
      }
      if (action === "send-private-chat") {
        const input = this.root.querySelector("[data-private-chat-input]");
        const msg = (input?.value ?? "").trim().slice(0, 120);
        const target = this.state.privateChatTarget;
        if (msg && target) {
          if (!this.state.privateChats[target]) this.state.privateChats[target] = [];
          const pCode = this.worldState.selectedCountryCode;
          this.state.privateChats[target] = [...this.state.privateChats[target], { from: pCode, text: msg }].slice(-30);
          // Bot auto-replies
          if (this.state.lockedCountries[target]?.startsWith("Bot ")) {
            const replies = ["Interesting proposal...", "We'll consider it.", "Not a chance.", "Perhaps we can work something out.", "Our terms are final.", "Show us gold first."];
            setTimeout(() => {
              this.state.privateChats[target] = [...(this.state.privateChats[target] || []), { from: target, text: replies[Math.floor(Math.random() * replies.length)] }].slice(-30);
              this.renderView();
            }, 800 + Math.random() * 1200);
          }
          this.renderView();
        }
      }
      if (action === "recruit-troops") {
        this.renderView();
      }
      if (action === "fortify-nation") {
        this.renderView();
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
        const targetCode = act.dataset.code;
        const nd = this.state.nationData;
        const atkNd = nd[playerCode];
        const defNd = nd[targetCode];
        const atk = countries.find((co) => co.code === playerCode);
        const def = countries.find((co) => co.code === targetCode);
        if (atkNd && defNd && atk && def) {
          // Attack power = ground troops + air troops * 2
          const atkPower = atkNd.groundTroops + atkNd.airTroops * 2;
          // Defense power = ground defense + air defense * 1.5 + half their troops
          const defPower = defNd.groundDef + defNd.airDef * 1.5 + Math.floor((defNd.groundTroops + defNd.airTroops) / 2);
          const ratio = atkPower / Math.max(1, atkPower + defPower);
          const odds = Math.min(90, Math.max(10, Math.round(ratio * 100)));
          const won = Math.random() * 100 < odds;
          // Attacker losses
          const gLoss = 1 + Math.floor(Math.random() * 3);
          const aLoss = Math.random() < 0.4 ? 1 : 0;
          atkNd.groundTroops = Math.max(1, atkNd.groundTroops - gLoss);
          atkNd.airTroops = Math.max(0, atkNd.airTroops - aLoss);
          // Defender losses
          const dgLoss = 1 + Math.floor(Math.random() * 4);
          const daLoss = Math.random() < 0.3 ? 1 : 0;
          defNd.groundTroops = Math.max(0, defNd.groundTroops - dgLoss);
          defNd.airTroops = Math.max(0, defNd.airTroops - daLoss);
          defNd.groundDef = Math.max(0, defNd.groundDef - Math.floor(Math.random() * 2));
          if (won) {
            const userName = this.state.currentUser?.username ?? "Player";
            this.state.lockedCountries[targetCode] = userName;
            nd[targetCode] = { ...defNd, groundTroops: Math.max(2, gLoss), airTroops: aLoss, gold: Math.floor(defNd.gold / 2) };
            this.state.publicChat = [
              `\u2694 VICTORY! ${atk.name} conquered ${def.name}! (Odds: ${odds}%)`,
              ...this.state.publicChat
            ].slice(0, 50);
          } else {
            this.state.publicChat = [
              `\u{1F525} REPELLED! ${atk.name} failed to take ${def.name} (Odds: ${odds}%)`,
              ...this.state.publicChat
            ].slice(0, 50);
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
    const nd = this.state.nationData;

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
              <div class="intro-final__stat"><strong>${Object.values(nd).reduce((s,n) => s + n.groundTroops + n.airTroops, 0)}</strong><span>Total Troops</span></div>
              <div class="intro-final__stat"><strong>${nd[this.worldState.selectedCountryCode]?.gold ?? 100}</strong><span>Starting Gold</span></div>
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
    const nNd = nd[code] || { groundTroops: 5, airTroops: 1 };
    const troops = nNd.groundTroops + nNd.airTroops;
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
      // Update timer display without full re-render
      const timerEl = this.root.querySelector("[data-turn-timer]");
      if (timerEl) timerEl.textContent = this.formatTimer(this.state.turnTimer);

      if (this.state.turnTimer <= 0) {
        // End of turn — bot actions + advance
        this._runBotTurns();
        this.state.turnNumber++;
        this.state.turnTimer = 120;
        this.state.turnPhase = "strategy";

        // Check win/loss
        const locked = this.state.lockedCountries;
        const username = this.state.currentUser?.username ?? "Player";
        const playerCode = this.worldState.selectedCountryCode;
        const alive = Object.entries(locked);
        const playerAlive = alive.some(([, n]) => n === username);
        if (!playerAlive) {
          this.state.publicChat = ["\u{1F480} YOUR NATION HAS FALLEN. DEFEAT.", ...this.state.publicChat].slice(0, 50);
          this.stopTurnTimer();
          this.renderView();
          return;
        }
        if (alive.length === 1 && alive[0][1] === username) {
          this.state.publicChat = ["\u{1F451} TOTAL DOMINATION! YOU WIN!", ...this.state.publicChat].slice(0, 50);
          this.stopTurnTimer();
          this.renderView();
          return;
        }
        this.renderView();
      }
    }, 1000);
  }

  _runBotTurns() {
    const countries = this.worldState.countries;
    const locked = this.state.lockedCountries;
    const nd = this.state.nationData;
    const username = this.state.currentUser?.username ?? "Player";

    for (const [botCode, botName] of Object.entries(locked)) {
      if (botName === username) continue; // skip player
      const botNd = nd[botCode];
      if (!botNd) continue;
      const co = countries.find((c) => c.code === botCode);

      // Bot income
      botNd.farmsUsed = 0;
      const income = 15 + Math.floor((co?.economyScore ?? 50) / 8) + botNd.farmLvl * 5;
      botNd.gold += income;

      // Bot farms
      const farmYield = 10 + botNd.farmLvl * 5 + Math.floor(Math.random() * 10);
      botNd.gold += farmYield;
      botNd.farmsUsed++;

      // Bot spending: random upgrades
      const roll = Math.random();
      if (roll < 0.25 && botNd.gold >= 20) {
        const ct = 2 + Math.floor(Math.random() * 3);
        botNd.gold -= 20;
        botNd.groundTroops += ct;
      } else if (roll < 0.45 && botNd.gold >= 35) {
        const ct = 1 + Math.floor(Math.random() * 2);
        botNd.gold -= 35;
        botNd.airTroops += ct;
      } else if (roll < 0.60 && botNd.gold >= 25) {
        botNd.gold -= 25;
        botNd.groundDef += 3;
      } else if (roll < 0.72 && botNd.gold >= 30) {
        botNd.gold -= 30;
        botNd.airDef += 2;
      } else if (roll < 0.82 && botNd.gold >= (40 + botNd.farmLvl * 20)) {
        botNd.gold -= (40 + botNd.farmLvl * 20);
        botNd.farmLvl++;
      }

      // Bot attack (60% chance)
      if (Math.random() < 0.6) {
        const targets = Object.keys(locked).filter((c) => c !== botCode);
        if (targets.length > 0) {
          const tCode = targets[Math.floor(Math.random() * targets.length)];
          const tNd = nd[tCode];
          if (tNd) {
            const atkP = botNd.groundTroops + botNd.airTroops * 2;
            const defP = tNd.groundDef + tNd.airDef * 1.5 + (tNd.groundTroops + tNd.airTroops) / 2;
            const odds = Math.min(90, Math.max(10, Math.round((atkP / Math.max(1, atkP + defP)) * 100)));
            const won = Math.random() * 100 < odds;

            // Attacker losses
            botNd.groundTroops = Math.max(0, botNd.groundTroops - (1 + Math.floor(Math.random() * 3)));
            if (Math.random() < 0.4) botNd.airTroops = Math.max(0, botNd.airTroops - 1);
            // Defender losses
            tNd.groundTroops = Math.max(0, tNd.groundTroops - (1 + Math.floor(Math.random() * 4)));
            if (Math.random() < 0.3) tNd.airTroops = Math.max(0, tNd.airTroops - 1);
            tNd.groundDef = Math.max(0, tNd.groundDef - Math.floor(Math.random() * 2));

            const tCo = countries.find((c) => c.code === tCode);
            if (won) {
              // Conquer
              const oldOwner = locked[tCode];
              locked[tCode] = botName;
              const loot = Math.floor(tNd.gold / 2);
              botNd.gold += loot;
              tNd.gold -= loot;
              // Transfer minimal garrison
              const garrison = Math.min(2, botNd.groundTroops);
              botNd.groundTroops -= garrison;
              tNd.groundTroops = garrison;
              tNd.airTroops = 0;
              tNd.groundDef = 1;
              tNd.airDef = 0;
              this.state.publicChat = [`\u2694 ${co?.name ?? botCode} conquered ${tCo?.name ?? tCode} (from ${oldOwner})!`, ...this.state.publicChat].slice(0, 50);
            } else {
              this.state.publicChat = [`\u{1F6E1} ${tCo?.name ?? tCode} repelled ${co?.name ?? botCode}'s attack!`, ...this.state.publicChat].slice(0, 50);
            }
          }
        }
      }
    }
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
    const turnTimer = this.state.turnTimer;
    const nd = this.state.nationData;
    const pNd = nd[playerCode] || { gold: 0, groundTroops: 0, airTroops: 0, groundDef: 0, airDef: 0, farmLvl: 1, farmsUsed: 0 };
    const activeTab = this.state.activeTab;
    const publicChat = this.state.publicChat;
    const privateChats = this.state.privateChats;
    const privateChatTarget = this.state.privateChatTarget;

    // Odds (ground/air combat)
    const atkPower = pNd.groundTroops + pNd.airTroops * 2;
    const tNd = attackTarget ? (nd[attackTarget] || { groundDef: 0, airDef: 0, groundTroops: 0, airTroops: 0 }) : null;
    const defPower = tNd ? (tNd.groundDef + tNd.airDef * 1.5 + (tNd.groundTroops + tNd.airTroops) / 2) : 0;
    const winOdds = tNd ? Math.min(90, Math.max(10, Math.round((atkPower / Math.max(1, atkPower + defPower)) * 100))) : 0;

    // Participants
    const participants = Object.entries(locked).map(([code, name]) => {
      const co = countries.find((c) => c.code === code);
      const isPlayer = name === username;
      return { code, name, co, isPlayer };
    });

    // SVG world map — ocean water + detailed continents with borders
    const worldSvg = `<svg class="tac-worldmap-svg" viewBox="0 0 1000 500" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="ocean-g" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stop-color="#0d2847"/>
          <stop offset="100%" stop-color="#061325"/>
        </radialGradient>
      </defs>
      <!-- Ocean water -->
      <rect fill="url(#ocean-g)" width="1000" height="500"/>
      <!-- Water texture lines -->
      <g stroke="#1a3f6e" stroke-width="0.2" opacity="0.15">
        ${Array.from({length: 20}, (_, i) => `<path d="M0,${25*i} Q250,${25*i + (i%2?8:-8)} 500,${25*i} T1000,${25*i}" fill="none"/>`).join("")}
      </g>
      <!-- Continents -->
      <g fill="#0f2318" stroke="#1a3d2a" stroke-width="0.8" opacity="0.92">
        <!-- North America -->
        <path d="M45,35 L80,28 L120,25 L155,30 L190,42 L220,60 L245,82 L260,110 L258,140 L240,165 L225,185 L210,200 L185,215 L165,210 L148,195 L130,188 L110,185 L95,178 L88,195 L82,215 L90,230 L105,242 L118,260 L115,268 L100,275 L85,268 L72,255 L58,240 L48,210 L42,180 L38,150 L33,120 L35,85 L38,55 Z"/>
        <!-- Alaska -->
        <path d="M28,42 L42,35 L48,42 L42,55 L30,58 L22,50 Z"/>
        <!-- Greenland -->
        <path d="M255,15 L290,10 L325,12 L348,25 L350,48 L342,62 L320,68 L295,62 L272,48 L258,32 Z"/>
        <!-- Central America -->
        <path d="M118,260 L132,255 L148,262 L160,270 L155,278 L142,282 L128,278 L120,270 Z"/>
        <!-- South America -->
        <path d="M160,278 L185,272 L210,268 L235,275 L258,290 L275,310 L290,335 L302,365 L310,395 L305,425 L295,448 L278,462 L258,470 L240,465 L228,450 L222,425 L215,400 L205,375 L192,350 L180,325 L172,305 L165,290 Z"/>
        <!-- Europe -->
        <path d="M408,42 L425,38 L445,40 L462,45 L482,42 L505,45 L525,50 L542,55 L538,68 L545,82 L540,95 L528,105 L515,108 L498,102 L485,108 L472,115 L458,112 L448,118 L435,115 L425,105 L418,92 L412,75 L408,58 Z"/>
        <!-- British Isles -->
        <path d="M392,52 L402,48 L408,55 L405,65 L398,68 L392,62 Z"/>
        <!-- Scandinavia -->
        <path d="M448,18 L462,15 L472,22 L478,35 L475,48 L465,42 L455,35 L450,28 Z"/>
        <!-- Africa -->
        <path d="M415,155 L438,148 L462,148 L488,152 L510,162 L530,178 L545,200 L555,228 L562,260 L560,295 L555,322 L545,350 L530,378 L512,395 L490,402 L465,398 L445,385 L432,365 L425,338 L420,308 L418,275 L415,245 L412,215 L410,185 Z"/>
        <!-- Madagascar -->
        <path d="M565,345 L572,340 L578,355 L575,372 L568,375 L562,362 Z"/>
        <!-- Middle East -->
        <path d="M528,108 L555,105 L578,110 L600,118 L618,132 L622,148 L612,165 L595,175 L572,172 L555,165 L540,152 L530,135 Z"/>
        <!-- Russia / Northern Asia -->
        <path d="M542,20 L575,18 L610,15 L650,18 L695,22 L740,25 L780,30 L818,35 L848,42 L845,55 L838,68 L815,72 L788,68 L755,65 L722,58 L690,60 L658,62 L628,58 L600,62 L575,55 L558,45 L548,32 Z"/>
        <!-- South/Central Asia -->
        <path d="M618,132 L645,125 L672,135 L695,148 L710,168 L712,195 L700,218 L682,235 L660,245 L638,238 L622,218 L615,195 L612,170 Z"/>
        <!-- India -->
        <path d="M632,235 L652,228 L672,238 L685,258 L680,280 L665,292 L648,288 L635,272 L628,255 Z"/>
        <!-- East Asia / China -->
        <path d="M695,55 L728,50 L758,58 L788,72 L810,88 L825,108 L828,132 L818,155 L800,168 L775,172 L752,165 L735,148 L722,128 L712,105 L705,82 Z"/>
        <!-- Korean Peninsula -->
        <path d="M815,88 L825,82 L832,92 L830,108 L822,112 L815,102 Z"/>
        <!-- Japan -->
        <path d="M838,78 L848,72 L858,78 L862,92 L858,108 L852,118 L845,122 L838,112 L835,95 Z"/>
        <!-- Southeast Asia -->
        <path d="M712,200 L735,195 L758,205 L775,218 L788,235 L798,255 L790,268 L772,272 L752,265 L735,252 L722,235 L715,218 Z"/>
        <!-- Indonesia -->
        <path d="M728,278 L752,272 L778,278 L802,285 L818,295 L812,305 L792,308 L768,305 L748,298 L732,290 Z"/>
        <!-- Philippines -->
        <path d="M798,218 L808,212 L815,222 L812,238 L805,242 L798,232 Z"/>
        <!-- Australia -->
        <path d="M752,335 L788,325 L822,328 L855,338 L878,358 L885,382 L878,405 L862,422 L838,430 L810,432 L782,425 L762,408 L750,385 L748,358 Z"/>
        <!-- New Zealand -->
        <path d="M888,405 L898,398 L905,412 L902,428 L895,435 L888,425 Z"/>
        <path d="M892,435 L898,432 L902,442 L898,448 L892,445 Z"/>
        <!-- Papua New Guinea -->
        <path d="M838,298 L858,292 L872,298 L868,312 L855,318 L842,312 Z"/>
      </g>
      <!-- Country border detail lines -->
      <g stroke="#2a5e3a" stroke-width="0.4" fill="none" opacity="0.5">
        <path d="M210,200 L195,215 L165,210"/>
        <path d="M462,148 L478,155 L488,152"/>
        <path d="M528,108 L540,115 L555,105"/>
        <path d="M695,148 L710,155 L712,168"/>
        <path d="M758,58 L775,65 L788,72"/>
        <path d="M545,200 L555,210 L562,228"/>
        <path d="M240,165 L225,175 L225,185"/>
        <path d="M635,238 L648,242 L660,245"/>
        <path d="M105,242 L115,248 L118,260"/>
        <path d="M832,92 L838,95 L838,78"/>
      </g>
      <!-- Latitude / longitude grid -->
      <g stroke="#1a3d5a" stroke-width="0.25" opacity="0.2">
        <line x1="0" y1="125" x2="1000" y2="125"/>
        <line x1="0" y1="250" x2="1000" y2="250"/>
        <line x1="0" y1="375" x2="1000" y2="375"/>
        <line x1="0" y1="62" x2="1000" y2="62"/>
        <line x1="0" y1="188" x2="1000" y2="188"/>
        <line x1="0" y1="312" x2="1000" y2="312"/>
        <line x1="0" y1="438" x2="1000" y2="438"/>
        <line x1="125" y1="0" x2="125" y2="500"/>
        <line x1="250" y1="0" x2="250" y2="500"/>
        <line x1="375" y1="0" x2="375" y2="500"/>
        <line x1="500" y1="0" x2="500" y2="500"/>
        <line x1="625" y1="0" x2="625" y2="500"/>
        <line x1="750" y1="0" x2="750" y2="500"/>
        <line x1="875" y1="0" x2="875" y2="500"/>
      </g>
      <!-- Equator highlight -->
      <line x1="0" y1="250" x2="1000" y2="250" stroke="#2a6080" stroke-width="0.4" opacity="0.35" stroke-dasharray="6,4"/>
    </svg>`;

    // Map territory nodes with ground + air counts
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
      const nNd = nd[code] || { groundTroops: 0, airTroops: 0 };
      return `
        <button class="${cls}" type="button"
          data-action="set-attack-target" data-code="${code}"
          style="left:${pos.x}%;top:${pos.y}%;--nc:${nodeColor}"
          title="${co.name}${isPlayer ? " (YOU)" : ` \u2014 ${name}`} | Ground: ${nNd.groundTroops} Air: ${nNd.airTroops}">
          <div class="tac-node__blob"></div>
          <span class="tac-node__flag">${this.getFlag(code)}</span>
          <span class="tac-node__troops">\u{1F6E1}${nNd.groundTroops} \u2708${nNd.airTroops}</span>
          <span class="tac-node__lbl">${co.name}</span>
          ${isPlayer ? `<span class="tac-node__star">\u2605</span>` : ""}
          ${isTarget ? `<span class="tac-node__crosshair">\u2295</span>` : ""}
        </button>
      `;
    }).join("");

    // Player rows with negotiate button
    const playerRows = participants.map(({ code, name, co, isPlayer }) => {
      const nNd = nd[code] || { groundTroops: 0, airTroops: 0, groundDef: 0, airDef: 0 };
      const totalPower = nNd.groundTroops + nNd.airTroops * 2;
      return `
        <div class="tac-player-row${isPlayer ? " tac-player-row--you" : ""}">
          <span class="tac-player-row__flag">${this.getFlag(code)}</span>
          <div class="tac-player-row__info">
            <span class="tac-player-row__name">${isPlayer ? "You" : name}</span>
            <span class="tac-player-row__territory">${co?.name ?? code}</span>
          </div>
          <span class="tac-player-row__troops">\u{1F6E1}${nNd.groundTroops} \u2708${nNd.airTroops}</span>
          ${!isPlayer ? `<button class="tac-negotiate-btn" type="button" data-action="open-negotiate" data-code="${code}" title="Negotiate">\u{1F4AC}</button>` : ""}
        </div>
      `;
    }).join("");

    const myTerritories = participants.filter((p) => p.isPlayer).length;
    const totalT = participants.length;

    const phaseLabel = turnPhase === "battle" ? "BATTLE PHASE" : "STRATEGY PHASE";
    const phaseHint = turnPhase === "battle"
      ? "Attack, farm, upgrade, or negotiate"
      : "Click 'Start Turn' to begin";

    const maxFarms = 1 + pNd.farmLvl;
    const farmCost = 40 + pNd.farmLvl * 20;
    const isBattle = turnPhase === "battle";

    // Tab content
    let tabContent = "";
    if (activeTab === "army") {
      tabContent = `
        <div class="tac-tab-content">
          <div class="tac-tab-content__header">\u2694 ARMY</div>
          <div class="tac-tab-stat-row"><span>\u{1F6E1} Ground Troops</span><strong>${pNd.groundTroops}</strong></div>
          <div class="tac-tab-stat-row"><span>\u2708 Air Units</span><strong>${pNd.airTroops}</strong></div>
          <div class="tac-tab-stat-row tac-tab-stat-row--total"><span>\u2694 Total Power</span><strong>${atkPower}</strong></div>
          <div class="tac-tab-actions">
            <button class="tac-tab-btn tac-tab-btn--ground" type="button" data-action="buy-ground-troops" ${!isBattle || pNd.gold < 20 ? "disabled" : ""}>\u{1F6E1} Buy Ground (20g) → +2-4</button>
            <button class="tac-tab-btn tac-tab-btn--air" type="button" data-action="buy-air-troops" ${!isBattle || pNd.gold < 35 ? "disabled" : ""}>\u2708 Buy Air (35g) → +1-2</button>
          </div>
        </div>
      `;
    } else if (activeTab === "homeland") {
      tabContent = `
        <div class="tac-tab-content">
          <div class="tac-tab-content__header">\u26E8 HOMELAND DEFENSE</div>
          <div class="tac-tab-stat-row"><span>\u{1F6E1} Ground Defense</span><strong>${pNd.groundDef}</strong></div>
          <div class="tac-tab-stat-row"><span>\u{1F6E1} Anti-Air Defense</span><strong>${pNd.airDef}</strong></div>
          <div class="tac-tab-stat-row tac-tab-stat-row--total"><span>\u26E8 Total Defense</span><strong>${Math.round(pNd.groundDef + pNd.airDef * 1.5)}</strong></div>
          <div class="tac-tab-actions">
            <button class="tac-tab-btn tac-tab-btn--ground" type="button" data-action="buy-ground-def" ${!isBattle || pNd.gold < 25 ? "disabled" : ""}>\u{1F6E1} Ground Def (25g) → +3</button>
            <button class="tac-tab-btn tac-tab-btn--air" type="button" data-action="buy-air-def" ${!isBattle || pNd.gold < 30 ? "disabled" : ""}>\u{1F6E1} Anti-Air (30g) → +2</button>
          </div>
        </div>
      `;
    } else if (activeTab === "farm") {
      tabContent = `
        <div class="tac-tab-content">
          <div class="tac-tab-content__header">\u{1F33E} FARMING</div>
          <div class="tac-tab-stat-row"><span>\u{1F33E} Farm Level</span><strong>${pNd.farmLvl}</strong></div>
          <div class="tac-tab-stat-row"><span>\u{1F33E} Harvests Left</span><strong>${maxFarms - pNd.farmsUsed}/${maxFarms}</strong></div>
          <div class="tac-tab-stat-row"><span>\u{1F4B0} Yield per Harvest</span><strong>~${10 + pNd.farmLvl * 5}g</strong></div>
          <div class="tac-tab-actions">
            <button class="tac-tab-btn tac-tab-btn--farm" type="button" data-action="farm-resources" ${!isBattle || pNd.farmsUsed >= maxFarms ? "disabled" : ""}>\u{1F33E} Harvest Gold</button>
            <button class="tac-tab-btn tac-tab-btn--upgrade" type="button" data-action="upgrade-farm" ${!isBattle || pNd.gold < farmCost ? "disabled" : ""}>\u2B06 Upgrade Farm (${farmCost}g)</button>
          </div>
        </div>
      `;
    } else if (activeTab === "chat") {
      const pubMsgs = publicChat.length
        ? publicChat.slice(0, 20).map((m) => `<div class="tac-chat-msg">${m}</div>`).join("")
        : `<div class="tac-chat-msg tac-chat-msg--hint">No messages yet...</div>`;
      let privateSection = "";
      if (privateChatTarget) {
        const targetCo = countries.find((c) => c.code === privateChatTarget);
        const pMsgs = (privateChats[privateChatTarget] || []).map((m) => {
          const isMe = m.from === playerCode;
          return `<div class="tac-chat-msg tac-chat-msg--${isMe ? "me" : "them"}">${this.getFlag(m.from)} ${m.text}</div>`;
        }).join("") || `<div class="tac-chat-msg tac-chat-msg--hint">Start a negotiation...</div>`;
        privateSection = `
          <div class="tac-private-chat">
            <div class="tac-private-chat__header">
              <span>\u{1F4AC} Negotiating with ${this.getFlag(privateChatTarget)} ${targetCo?.name ?? privateChatTarget}</span>
              <button class="tac-private-chat__close" type="button" data-action="close-negotiate">\u2715</button>
            </div>
            <div class="tac-private-chat__body">${pMsgs}</div>
            <div class="tac-private-chat__input-row">
              <input type="text" data-private-chat-input placeholder="Message..." maxlength="120" class="tac-chat-input"/>
              <button class="tac-chat-send-btn" type="button" data-action="send-private-chat">\u27A4</button>
            </div>
          </div>
        `;
      }
      tabContent = `
        <div class="tac-tab-content tac-tab-content--chat">
          <div class="tac-tab-content__header">\u{1F4AC} COMMUNICATIONS</div>
          ${privateSection}
          <div class="tac-public-chat">
            <div class="tac-public-chat__header">\u{1F310} Public Chat</div>
            <div class="tac-public-chat__body">${pubMsgs}</div>
            <div class="tac-public-chat__input-row">
              <input type="text" data-public-chat-input placeholder="Public message..." maxlength="120" class="tac-chat-input"/>
              <button class="tac-chat-send-btn" type="button" data-action="send-public-chat">\u27A4</button>
            </div>
          </div>
        </div>
      `;
    }

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

          <!-- Left panel: tabs + tab content -->
          <div class="tac-side tac-side--left">
            <div class="tac-tabs">
              <button class="tac-tabs__btn${activeTab === "army" ? " tac-tabs__btn--active" : ""}" type="button" data-action="set-tab" data-tab="army">\u2694 Army</button>
              <button class="tac-tabs__btn${activeTab === "homeland" ? " tac-tabs__btn--active" : ""}" type="button" data-action="set-tab" data-tab="homeland">\u26E8 Defense</button>
              <button class="tac-tabs__btn${activeTab === "farm" ? " tac-tabs__btn--active" : ""}" type="button" data-action="set-tab" data-tab="farm">\u{1F33E} Farm</button>
              <button class="tac-tabs__btn${activeTab === "chat" ? " tac-tabs__btn--active" : ""}" type="button" data-action="set-tab" data-tab="chat">\u{1F4AC} Chat</button>
            </div>
            ${tabContent}
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
                <div class="tac-atk-stat">\u{1F6E1} ${pNd.groundTroops} ground</div>
                <div class="tac-atk-stat">\u2708 ${pNd.airTroops} air</div>
                <div class="tac-atk-stat tac-atk-stat--power">\u2694 Power: ${atkPower}</div>
              </div>
              <div class="tac-atk-vs">VS</div>
              <div class="tac-atk-side tac-atk-side--enemy">
                <span class="tac-atk-flag">${this.getFlag(attackTarget)}</span>
                <div class="tac-atk-name">${targetData.name}</div>
                <div class="tac-atk-stat">\u{1F6E1} ${tNd.groundDef} ground def</div>
                <div class="tac-atk-stat">\u{1F6E1} ${tNd.airDef} anti-air</div>
                <div class="tac-atk-stat">\u{1F6E1} ${tNd.groundTroops}+${tNd.airTroops} troops</div>
                <div class="tac-atk-stat tac-atk-stat--power">\u26E8 Defense: ${Math.round(defPower)}</div>
              </div>
            </div>
            <div class="tac-atk-odds-row">
              <span class="tac-atk-odds-lbl">Victory Odds</span>
              <div class="tac-atk-odds-bar"><div class="tac-atk-odds-fill" style="width:${winOdds}%"></div></div>
              <span class="tac-atk-odds-pct">${winOdds}%</span>
            </div>
            <div class="tac-atk-btns">
              <button class="tac-atk-btn tac-atk-btn--launch" type="button" data-action="confirm-attack" data-code="${attackTarget}" ${!isBattle ? "disabled" : ""}>\u2694 Launch Attack</button>
              <button class="tac-atk-btn tac-atk-btn--cancel" type="button" data-action="set-attack-target" data-code="${attackTarget}">Cancel</button>
            </div>
          </div>
        ` : ""}

        <!-- ── BOTTOM BAR ─────────────────────────── -->
        <div class="tac-bottombar">
          <div class="tac-bottombar__left">
            <span class="tac-res-icon">\u{1F4B0}</span>
            <span class="tac-res-val">${pNd.gold}</span>
            <span class="tac-res-lbl">gold</span>
            <span class="tac-res-divider">\u2022</span>
            <span class="tac-res-icon">\u{1F6E1}</span>
            <span class="tac-res-val">${pNd.groundTroops}</span>
            <span class="tac-res-lbl">ground</span>
            <span class="tac-res-divider">\u2022</span>
            <span class="tac-res-icon">\u2708</span>
            <span class="tac-res-val">${pNd.airTroops}</span>
            <span class="tac-res-lbl">air</span>
            <span class="tac-res-divider">\u2022</span>
            <span class="tac-res-icon">\u26E8</span>
            <span class="tac-res-val">${pNd.groundDef + pNd.airDef}</span>
            <span class="tac-res-lbl">def</span>
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