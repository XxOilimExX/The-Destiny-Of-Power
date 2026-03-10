/**
 * CloudDB — Firebase Firestore wrapper for The Destiny Of Power
 *
 * When CLOUD_ENABLED is false (no apiKey in cloud.js) every method
 * returns null / [] immediately and the app works in local-only mode.
 */

import { FIREBASE_CONFIG } from "../config/cloud.js";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query as fbQuery,
  where,
  orderBy,
  limit,
  getDocs,
  arrayUnion,
} from "firebase/firestore";

export const CLOUD_ENABLED = typeof FIREBASE_CONFIG.apiKey === "string" && FIREBASE_CONFIG.apiKey.length > 0;

let _db = null;

if (CLOUD_ENABLED) {
  try {
    const app = initializeApp(FIREBASE_CONFIG);
    _db = getFirestore(app);
  } catch (e) {
    console.warn("[TDP Cloud] Firebase init failed:", e.message);
  }
}

export const CloudDB = {
  /** True once the Firestore instance is available */
  ready() {
    return !!_db;
  },

  /* ── Users ─────────────────────────────────────────────────────── */

  /**
   * Write a new user document.
   * @param {{ username, normalizedUsername, passwordHash, createdAt }} user
   */
  async createUser(user) {
    if (!_db) return;
    try {
      await setDoc(doc(_db, "users", user.normalizedUsername), {
        username: user.username,
        normalizedUsername: user.normalizedUsername,
        passwordHash: user.passwordHash,
        createdAt: user.createdAt,
      });
    } catch (e) {
      console.warn("[TDP Cloud] createUser:", e.message);
    }
  },

  /**
   * Fetch a user by their normalised username. Returns null if not found.
   * @param {string} normalizedUsername
   */
  async getUser(normalizedUsername) {
    if (!_db) return null;
    try {
      const snap = await getDoc(doc(_db, "users", normalizedUsername));
      return snap.exists() ? snap.data() : null;
    } catch {
      return null;
    }
  },

  /**
   * Prefix-search users by normalised username.
   * Returns up to 10 matching usernames (display names), excluding excludeUser.
   * @param {string} searchQuery
   * @param {string} excludeUser
   */
  async searchUsers(searchQuery, excludeUser) {
    if (!_db) return [];
    try {
      const q = searchQuery.trim().toLowerCase();
      if (q.length < 2) return [];
      const snap = await getDocs(
        fbQuery(
          collection(_db, "users"),
          where("normalizedUsername", ">=", q),
          where("normalizedUsername", "<=", q + "\uf8ff"),
          limit(10),
        ),
      );
      return snap.docs
        .map((d) => d.data().username)
        .filter((u) => u !== excludeUser);
    } catch {
      return [];
    }
  },

  /* ── Servers ───────────────────────────────────────────────────── */

  /**
   * Create a new server lobby document.
   * @param {{ code: string, host: string, region: string }} opts
   */
  async createServer({ code, host, region }) {
    if (!_db) return;
    try {
      await setDoc(doc(_db, "servers", code), {
        code,
        host,
        region,
        players: [host],
        createdAt: Date.now(),
        status: "open",
      });
    } catch (e) {
      console.warn("[TDP Cloud] createServer:", e.message);
    }
  },

  /**
   * Fetch a server by code. Returns null if not found.
   * @param {string} code
   */
  async getServer(code) {
    if (!_db) return null;
    try {
      const snap = await getDoc(doc(_db, "servers", code));
      return snap.exists() ? snap.data() : null;
    } catch {
      return null;
    }
  },

  /**
   * Add a player to a server and return the updated server data.
   * Returns null if the server doesn't exist.
   * @param {string} code
   * @param {string} username
   */
  async joinServer(code, username) {
    if (!_db) return null;
    try {
      const ref = doc(_db, "servers", code);
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      await updateDoc(ref, { players: arrayUnion(username) });
      const updated = await getDoc(ref);
      return updated.data();
    } catch {
      return null;
    }
  },

  /**
   * Delete (close) a server lobby.
   * @param {string} code
   */
  async deleteServer(code) {
    if (!_db) return;
    try {
      await deleteDoc(doc(_db, "servers", code));
    } catch (e) {
      console.warn("[TDP Cloud] deleteServer:", e.message);
    }
  },

  /**
   * Return open servers created in the last 6 hours, newest first.
   */
  async getPublicServers() {
    if (!_db) return [];
    try {
      const cutoff = Date.now() - 6 * 60 * 60 * 1000;
      const snap = await getDocs(
        fbQuery(
          collection(_db, "servers"),
          where("createdAt", ">", cutoff),
          orderBy("createdAt", "desc"),
          limit(20),
        ),
      );
      return snap.docs.map((d) => d.data()).filter((s) => s.status === "open");
    } catch {
      return [];
    }
  },
};
