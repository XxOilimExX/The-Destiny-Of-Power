const FRIENDS_KEY = "tdop-friends";
const REQUESTS_KEY = "tdop-friend-requests";
const PROFILES_KEY = "tdop-profiles";
const USERS_KEY = "tdop-cloud-users";
const CHEST_KEY = "tdop-chest-cooldown";

/* ─── Titles ──────────────────────────────────────── */
export const TITLES = [
  { id: "recruit", label: "Recruit", default: true },
  { id: "soldier", label: "Soldier", default: true },
  { id: "veteran", label: "Veteran" },
  { id: "elite", label: "Elite Operative" },
  { id: "legend", label: "Legend" },
  { id: "dark-soul", label: "Dark Soul" },
  { id: "warlord", label: "Warlord" },
  { id: "phantom", label: "Phantom" },
  { id: "overlord", label: "Overlord" },
  { id: "god-of-war", label: "God of War" },
];

/* ─── Chest Loot Table ────────────────────────────── */
const CHEST_COOLDOWN = 12 * 60 * 60 * 1000; // 12 hours

const RARITY_TABLE = [
  { rarity: "legendary", chance: 0.01, color: "#ffaa00" },
  { rarity: "mythic", chance: 0.05, color: "#d946ef" },
  { rarity: "epic", chance: 0.14, color: "#a855f7" },
  { rarity: "rare", chance: 0.30, color: "#3b82f6" },
  { rarity: "common", chance: 0.50, color: "#6b7280" },
];

const CHEST_REWARDS = {
  avatar: [
    { id: 3, label: "Phoenix", rarity: "rare" },
    { id: 4, label: "Titan", rarity: "epic" },
    { id: 5, label: "Shadow", rarity: "epic" },
    { id: 6, label: "Dragon", rarity: "mythic" },
    { id: 7, label: "Viper", rarity: "rare" },
    { id: 8, label: "Reaper", rarity: "legendary" },
    { id: 9, label: "Celestial", rarity: "legendary" },
    { id: 10, label: "Demon", rarity: "mythic" },
    { id: 11, label: "Samurai", rarity: "epic" },
    { id: 12, label: "Knight", rarity: "rare" },
    { id: 13, label: "Ghost", rarity: "rare" },
    { id: 14, label: "Skull", rarity: "common" },
  ],
  banner: [
    { id: 3, label: "Gold", rarity: "rare" },
    { id: 4, label: "Emerald", rarity: "rare" },
    { id: 5, label: "Royal", rarity: "epic" },
    { id: 6, label: "Arctic", rarity: "epic" },
    { id: 7, label: "Inferno", rarity: "mythic" },
    { id: 8, label: "Void", rarity: "legendary" },
    { id: 9, label: "Neon", rarity: "mythic" },
    { id: 10, label: "Blood Moon", rarity: "epic" },
    { id: 11, label: "Frost", rarity: "rare" },
    { id: 12, label: "Toxic", rarity: "common" },
  ],
  title: [
    { id: "veteran", label: "Veteran", rarity: "common" },
    { id: "elite", label: "Elite Operative", rarity: "rare" },
    { id: "legend", label: "Legend", rarity: "epic" },
    { id: "dark-soul", label: "Dark Soul", rarity: "epic" },
    { id: "warlord", label: "Warlord", rarity: "mythic" },
    { id: "phantom", label: "Phantom", rarity: "mythic" },
    { id: "overlord", label: "Overlord", rarity: "legendary" },
    { id: "god-of-war", label: "God of War", rarity: "legendary" },
  ],
};

export { RARITY_TABLE, CHEST_REWARDS };

export class SocialService {
  constructor() {
    this.onNotification = null;
    this._onlineSimInterval = null;
  }

  /* ── Default Profile ─────────────────────────────── */
  static defaultProfile() {
    return {
      bio: "",
      avatar: 0,
      banner: 0,
      title: "recruit",
      customAvatar: "",
      unlockedAvatars: [0, 1, 2],
      unlockedBanners: [0, 1, 2],
      unlockedTitles: ["recruit", "soldier"],
      lastChestOpen: 0,
    };
  }

  /* ── Profile ─────────────────────────────────────── */
  getProfile(username) {
    const profiles = this._getProfiles();
    const def = SocialService.defaultProfile();
    const p = profiles[username] || {};
    return { ...def, ...p };
  }

  saveProfile(username, data) {
    const profiles = this._getProfiles();
    const existing = this.getProfile(username);
    profiles[username] = { ...existing, ...data };
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  }

  /* ── Chest System ────────────────────────────────── */
  canOpenChest(username) {
    const p = this.getProfile(username);
    return Date.now() - (p.lastChestOpen || 0) >= CHEST_COOLDOWN;
  }

  getChestCooldownRemaining(username) {
    const p = this.getProfile(username);
    const elapsed = Date.now() - (p.lastChestOpen || 0);
    return Math.max(0, CHEST_COOLDOWN - elapsed);
  }

  openChest(username) {
    if (!this.canOpenChest(username)) throw new Error("Chest is on cooldown.");

    // Roll rarity
    const roll = Math.random();
    let cumulative = 0;
    let rarity = "common";
    for (const tier of RARITY_TABLE) {
      cumulative += tier.chance;
      if (roll <= cumulative) { rarity = tier.rarity; break; }
    }

    // Pick reward category
    const categories = ["avatar", "banner", "title"];
    const category = categories[Math.floor(Math.random() * categories.length)];

    // Find items of this rarity in category
    let pool = CHEST_REWARDS[category].filter((r) => r.rarity === rarity);
    // Fallback to common if empty
    if (pool.length === 0) pool = CHEST_REWARDS[category].filter((r) => r.rarity === "common");
    if (pool.length === 0) pool = CHEST_REWARDS[category];

    const reward = pool[Math.floor(Math.random() * pool.length)];

    // Unlock
    const profile = this.getProfile(username);
    let duplicate = false;
    if (category === "avatar") {
      if (profile.unlockedAvatars.includes(reward.id)) { duplicate = true; }
      else { profile.unlockedAvatars.push(reward.id); }
    } else if (category === "banner") {
      if (profile.unlockedBanners.includes(reward.id)) { duplicate = true; }
      else { profile.unlockedBanners.push(reward.id); }
    } else {
      if (profile.unlockedTitles.includes(reward.id)) { duplicate = true; }
      else { profile.unlockedTitles.push(reward.id); }
    }

    profile.lastChestOpen = Date.now();
    this.saveProfile(username, profile);

    return { category, rarity, reward, duplicate };
  }

  /* ── Friend Requests ─────────────────────────────── */
  sendFriendRequest(fromUser, toUser) {
    if (fromUser === toUser) throw new Error("You cannot add yourself.");
    const friends = this.getFriends(fromUser);
    if (friends.includes(toUser)) throw new Error("Already friends with this commander.");

    const requests = this._getRequests();
    const key = `${fromUser}→${toUser}`;
    const reverseKey = `${toUser}→${fromUser}`;

    // If they already sent us a request, auto-accept
    if (requests[reverseKey]) {
      delete requests[reverseKey];
      localStorage.setItem(REQUESTS_KEY, JSON.stringify(requests));
      this._addFriend(fromUser, toUser);
      this._notify("accepted", toUser);
      return "accepted";
    }

    if (requests[key]) throw new Error("Friend request already sent.");
    requests[key] = { from: fromUser, to: toUser, at: Date.now() };
    localStorage.setItem(REQUESTS_KEY, JSON.stringify(requests));
    this._notify("sent", toUser);
    return "sent";
  }

  getIncomingRequests(username) {
    const requests = this._getRequests();
    return Object.values(requests).filter((r) => r.to === username);
  }

  getOutgoingRequests(username) {
    const requests = this._getRequests();
    return Object.values(requests).filter((r) => r.from === username);
  }

  acceptRequest(currentUser, fromUser) {
    const requests = this._getRequests();
    const key = `${fromUser}→${currentUser}`;
    if (!requests[key]) throw new Error("No pending request from this user.");
    delete requests[key];
    localStorage.setItem(REQUESTS_KEY, JSON.stringify(requests));
    this._addFriend(currentUser, fromUser);
    this._notify("accepted", fromUser);
  }

  declineRequest(currentUser, fromUser) {
    const requests = this._getRequests();
    const key = `${fromUser}→${currentUser}`;
    delete requests[key];
    localStorage.setItem(REQUESTS_KEY, JSON.stringify(requests));
  }

  /* ── Friends List ────────────────────────────────── */
  getFriends(username) {
    const data = this._getFriendsData();
    return data[username] || [];
  }

  removeFriend(userA, userB) {
    const data = this._getFriendsData();
    data[userA] = (data[userA] || []).filter((f) => f !== userB);
    data[userB] = (data[userB] || []).filter((f) => f !== userA);
    localStorage.setItem(FRIENDS_KEY, JSON.stringify(data));
  }

  /* ── Search ──────────────────────────────────────── */
  searchUsers(query, currentUser) {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    try {
      const raw = localStorage.getItem(USERS_KEY);
      const users = raw ? JSON.parse(raw) : [];
      return users
        .filter((u) => u.normalizedUsername.includes(q) && u.username !== currentUser)
        .slice(0, 10)
        .map((u) => u.username);
    } catch {
      return [];
    }
  }

  /* ── Simulated Online Status ─────────────────────── */
  startOnlineSimulation(currentUser) {
    if (this._onlineSimInterval) return;
    const friends = this.getFriends(currentUser);
    if (friends.length === 0) return;

    this._onlineSimInterval = setInterval(() => {
      const friend = friends[Math.floor(Math.random() * friends.length)];
      if (Math.random() < 0.3) { // 30% chance every 45s
        this._notify("online", friend);
      }
    }, 45000);
  }

  stopOnlineSimulation() {
    clearInterval(this._onlineSimInterval);
    this._onlineSimInterval = null;
  }

  /* ── Internals ───────────────────────────────────── */
  _addFriend(userA, userB) {
    const data = this._getFriendsData();
    if (!data[userA]) data[userA] = [];
    if (!data[userB]) data[userB] = [];
    if (!data[userA].includes(userB)) data[userA].push(userB);
    if (!data[userB].includes(userA)) data[userB].push(userA);
    localStorage.setItem(FRIENDS_KEY, JSON.stringify(data));
  }

  _notify(type, relatedUser) {
    if (this.onNotification) this.onNotification(type, relatedUser);
  }

  _getRequests() {
    try {
      const raw = localStorage.getItem(REQUESTS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  _getFriendsData() {
    try {
      const raw = localStorage.getItem(FRIENDS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  _getProfiles() {
    try {
      const raw = localStorage.getItem(PROFILES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }
}
