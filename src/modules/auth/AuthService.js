import { containsProfanity } from "../../utils/profanityFilter.js";

const USERS_STORAGE_KEY = "tdop-cloud-users";
const SESSION_STORAGE_KEY = "tdop-active-user";
const CLEANUP_KEY = "tdop-last-cleanup";

export class AuthService {
  constructor() {
    this.runDailyCleanup();
  }

  async getCurrentUser() {
    await this.delay(220);

    const users = this.getUsers();
    const activeUsername = localStorage.getItem(SESSION_STORAGE_KEY);

    if (!activeUsername) {
      return null;
    }

    return users.find((user) => user.username === activeUsername) ?? null;
  }

  async register({ username, password, passwordConfirm }) {
    await this.delay(420);

    const normalizedUsername = username.trim().toLowerCase();
    const users = this.getUsers();

    if (normalizedUsername.length < 3) {
      throw new Error("Username must contain at least 3 characters.");
    }

    if (!/^[a-z0-9 _-]+$/i.test(username)) {
      throw new Error("Username may only contain letters, numbers, spaces, hyphens and underscores.");
    }

    if (containsProfanity(username)) {
      throw new Error("Username contains inappropriate language. Choose a different name.");
    }

    if (containsProfanity(password)) {
      throw new Error("Password contains inappropriate language. Choose a different password.");
    }

    if (password.length < 8) {
      throw new Error("Password must contain at least 8 characters.");
    }

    if (password !== passwordConfirm) {
      throw new Error("Passwords do not match.");
    }

    const usernameTaken = users.some((user) => user.normalizedUsername === normalizedUsername);

    if (usernameTaken) {
      throw new Error("This username is already in use. Choose another commander name.");
    }

    const user = {
      username: username.trim(),
      normalizedUsername,
      passwordHash: await this.hashPassword(password),
      createdAt: new Date().toISOString(),
    };

    users.push(user);
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
    localStorage.setItem(SESSION_STORAGE_KEY, user.username);

    return user;
  }

  async login({ username, password }) {
    await this.delay(320);

    const normalizedUsername = username.trim().toLowerCase();
    const users = this.getUsers();

    if (normalizedUsername.length < 3) {
      throw new Error("Username must contain at least 3 characters.");
    }

    if (password.length < 8) {
      throw new Error("Password must contain at least 8 characters.");
    }

    const user = users.find((entry) => entry.normalizedUsername === normalizedUsername);

    if (!user) {
      throw new Error("No account found for that commander name.");
    }

    const passwordHash = await this.hashPassword(password);

    if (user.passwordHash !== passwordHash) {
      throw new Error("Incorrect password.");
    }

    localStorage.setItem(SESSION_STORAGE_KEY, user.username);
    return user;
  }

  async logout() {
    await this.delay(120);
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }

  getUsers() {
    try {
      const value = localStorage.getItem(USERS_STORAGE_KEY);
      return value ? JSON.parse(value) : [];
    } catch {
      return [];
    }
  }

  async hashPassword(password) {
    const data = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  /* ─── Daily Cleanup ─────────────────────────────── */
  runDailyCleanup() {
    const last = localStorage.getItem(CLEANUP_KEY);
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    if (last && now - Number(last) < DAY) return;

    const users = this.getUsers();
    const clean = users.filter((u) => !containsProfanity(u.username));

    if (clean.length !== users.length) {
      localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(clean));
    }
    localStorage.setItem(CLEANUP_KEY, String(now));
  }

  delay(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }
}