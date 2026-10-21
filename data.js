/**
 * data.js - Safety Store & Data Layer for Jugnu
 * Handles local persistence, validation, community voting, and initial seed reports.
 */
"use strict";

class SafetyStore {
  /**
   * Initializes the safety store from localStorage or seeds it on first run.
   * @param {string} storageKey - LocalStorage key for reports.
   */
  constructor(storageKey = "jugnu_reports_v1") {
    this.storageKey = storageKey;
    this.votesKey = "jugnu_votes";
    this.memoryFallbackReports = null;
    this.memoryFallbackVotes = {};

    // Load existing reports or seed initial Mumbai dataset
    const existing = this._load();
    if (!existing || !Array.isArray(existing) || existing.length === 0) {
      const seeded = SafetyStore.seedData();
      this._save(seeded);
    }
  }

  /**
   * Determines whether a given timestamp falls during nighttime hours (7 PM to 6 AM local).
   * @param {number} timestamp - Epoch milliseconds.
   * @returns {boolean} True if night report.
   */
  static isNightTime(timestamp) {
    const date = new Date(timestamp);
    const hour = date.getHours();
    return hour >= 19 || hour < 6;
  }

  /**
   * Generates epoch timestamp for seed data based on daysAgo and target local HH:MM.
   * @param {number} daysAgo - Days before current date.
   * @param {string} timeStr - "HH:MM" 24-hour time.
   * @returns {number} Epoch milliseconds.
   */
  static _createSeedTimestamp(daysAgo, timeStr) {
    const now = new Date();
    const [hours, minutes] = timeStr.split(":").map(Number);
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hours, minutes, 0, 0);
    if (target.getTime() > now.getTime()) {
      target.setDate(target.getDate() - 1);
    }
    return target.getTime();
  }

  /**
   * Generates the pre-seeded Mumbai dataset with 10 verified street reports.
   * @returns {Array<Object>} 10 structured SafetyReport objects.
   */
  static seedData() {
    const rawSeeds = [
      {
        id: "r_seed_01",
        areaName: "Veera Desai Road near Azad Nagar Metro, Andheri West",
        lat: 19.1290,
        lng: 72.8370,
        status: "caution",
        tags: ["Dim / flickering lights", "Isolated after 10 PM"],
        note: "Stretch behind the metro pillars gets dim once shops pull shutters. Two lights flicker.",
        confirmations: 6,
        resolvedCount: 0,
        daysAgo: 1,
        time: "22:15"
      },
      {
        id: "r_seed_02",
        areaName: "Dadar TT Circle, near Tilak Bridge",
        lat: 19.0190,
        lng: 72.8440,
        status: "safe",
        tags: ["Streetlights working", "Crowd around", "Police / guard nearby"],
        note: "Busy junction with a traffic police booth at the circle. Tea stalls stay open.",
        confirmations: 14,
        resolvedCount: 0,
        daysAgo: 1,
        time: "08:45"
      },
      {
        id: "r_seed_03",
        areaName: "Carter Road Promenade, Bandra West",
        lat: 19.0693,
        lng: 72.8226,
        status: "safe",
        tags: ["Streetlights working", "Crowd around", "Shops open late"],
        note: "Joggers and families around till late. Cafes and ice-cream stalls open.",
        confirmations: 11,
        resolvedCount: 0,
        daysAgo: 5,
        time: "21:10"
      },
      {
        id: "r_seed_04",
        areaName: "Kurla Station Skywalk Exit, Kurla West",
        lat: 19.0652,
        lng: 72.8790,
        status: "unsafe",
        tags: ["Broken streetlights", "Isolated lane"],
        note: "Skywalk exit toward the bus depot has two dead lights. Hawkers leave by 9 PM.",
        confirmations: 9,
        resolvedCount: 1,
        daysAgo: 2,
        time: "21:45"
      },
      {
        id: "r_seed_05",
        areaName: "IIT Bombay Main Gate, Powai",
        lat: 19.1334,
        lng: 72.9133,
        status: "safe",
        tags: ["Police / guard nearby", "Streetlights working", "CCTV visible"],
        note: "Guard cabin at the gate and an auto stand with drivers present.",
        confirmations: 8,
        resolvedCount: 0,
        daysAgo: 4,
        time: "16:30"
      },
      {
        id: "r_seed_06",
        areaName: "Marine Drive Promenade, near Churchgate",
        lat: 18.9430,
        lng: 72.8235,
        status: "safe",
        tags: ["Streetlights working", "Crowd around", "Police / guard nearby"],
        note: "Police van parked near the steps. Lit and busy past midnight.",
        confirmations: 13,
        resolvedCount: 0,
        daysAgo: 2,
        time: "20:50"
      },
      {
        id: "r_seed_07",
        areaName: "Station Service Lane, Borivali West",
        lat: 19.2297,
        lng: 72.8561,
        status: "unsafe",
        tags: ["Pitch dark", "Stalking reported", "Isolated lane"],
        note: "No lights behind the station parking. One woman reported being followed to the main road.",
        confirmations: 7,
        resolvedCount: 0,
        daysAgo: 1,
        time: "22:50"
      },
      {
        id: "r_seed_08",
        areaName: "College Lane near Mithibai College, Vile Parle West",
        lat: 19.1056,
        lng: 72.8372,
        status: "caution",
        tags: ["Stray dogs", "No shops nearby"],
        note: "Lane behind the college canteen. Stray dogs gather after classes. Shops shut by 8 PM.",
        confirmations: 5,
        resolvedCount: 0,
        daysAgo: 4,
        time: "16:40"
      },
      {
        id: "r_seed_09",
        areaName: "Senapati Bapat Marg Subway, Lower Parel",
        lat: 18.9935,
        lng: 72.8315,
        status: "unsafe",
        tags: ["Broken streetlights", "Pitch dark"],
        note: "Pedestrian subway stretch has three lamps out and no staff on duty.",
        confirmations: 7,
        resolvedCount: 0,
        daysAgo: 3,
        time: "23:30"
      },
      {
        id: "r_seed_10",
        areaName: "Thane Station Skywalk, Thane West",
        lat: 19.1863,
        lng: 72.9748,
        status: "caution",
        tags: ["Dim / flickering lights", "Poor visibility at turn"],
        note: "Skywalk stairs toward Gokhale Road: half the lights flicker. Crowd thins after 11 PM.",
        confirmations: 4,
        resolvedCount: 0,
        daysAgo: 2,
        time: "23:05"
      }
    ];

    return rawSeeds.map(item => {
      const ts = SafetyStore._createSeedTimestamp(item.daysAgo, item.time);
      return {
        id: item.id,
        lat: Number(item.lat.toFixed(6)),
        lng: Number(item.lng.toFixed(6)),
        status: item.status,
        tags: item.tags,
        note: item.note,
        areaName: item.areaName,
        timestamp: ts,
        isNightReport: SafetyStore.isNightTime(ts),
        confirmations: item.confirmations,
        resolvedCount: item.resolvedCount
      };
    });
  }

  /**
   * Retrieves all reports stored in persistence, including soft-resolved ones.
   * @returns {Array<Object>} All reports.
   */
  getAll() {
    return this._load();
  }

  /**
   * Returns active reports (resolvedCount < 3) filtered by the selected view mode.
   * @param {string} filter - "all" | "unsafe" | "caution" | "safe" | "night"
   * @returns {Array<Object>} Filtered list of visible reports.
   */
  getVisible(filter = "all") {
    const all = this._load();
    const active = all.filter(r => r.resolvedCount < 3);

    if (filter === "all") return active;
    if (filter === "unsafe") return active.filter(r => r.status === "unsafe");
    if (filter === "caution") return active.filter(r => r.status === "caution");
    if (filter === "safe") return active.filter(r => r.status === "safe");
    if (filter === "night") return active.filter(r => r.isNightReport === true);
    return active;
  }

  /**
   * Retrieves a single report by its unique ID.
   * @param {string} id - Report ID.
   * @returns {Object|null} Matching report or null.
   */
  getById(id) {
    const all = this._load();
    return all.find(r => r.id === id) || null;
  }

  /**
   * Validates and publishes a new community safety report.
   * @param {Object} reportData - Fields: lat, lng, status, tags, note, areaName
   * @returns {Object} Newly created SafetyReport.
   */
  add({ lat, lng, status, tags = [], note = "", areaName = "" }) {
    // Validate coordinates
    const numericLat = Number(lat);
    const numericLng = Number(lng);
    if (!Number.isFinite(numericLat) || numericLat < -90 || numericLat > 90) {
      throw new Error("Invalid latitude value.");
    }
    if (!Number.isFinite(numericLng) || numericLng < -180 || numericLng > 180) {
      throw new Error("Invalid longitude value.");
    }

    // Validate status
    const validStatuses = ["safe", "caution", "unsafe"];
    if (!validStatuses.includes(status)) {
      throw new Error("Invalid safety status. Expected safe, caution, or unsafe.");
    }

    // Vocabulary for tag validation
    const validVocabulary = [
      "Streetlights working", "Crowd around", "Shops open late", "Police / guard nearby", "CCTV visible", "Pharmacy open 24x7",
      "Dim / flickering lights", "Isolated after 10 PM", "Stray dogs", "No shops nearby", "Blocked footpath", "Poor visibility at turn",
      "Pitch dark", "Broken streetlights", "Harassment reported", "Stalking reported", "Isolated lane", "Drunk groups"
    ];

    // Sanitize and deduplicate tags
    const cleanTags = Array.isArray(tags)
      ? Array.from(new Set(tags.filter(t => typeof t === "string" && validVocabulary.includes(t.trim())))).slice(0, 6)
      : [];

    // Sanitize note (max 140 characters)
    const cleanNote = typeof note === "string" ? note.trim().slice(0, 140) : "";

    // Sanitize area name
    const cleanAreaName = typeof areaName === "string" && areaName.trim().length > 0
      ? areaName.trim()
      : `Pinned location (${numericLat.toFixed(4)}, ${numericLng.toFixed(4)})`;

    const now = Date.now();
    const newId = "r_" + now.toString(36) + Math.random().toString(36).slice(2, 6);

    const report = {
      id: newId,
      lat: Number(numericLat.toFixed(6)),
      lng: Number(numericLng.toFixed(6)),
      status: status,
      tags: cleanTags,
      note: cleanNote,
      areaName: cleanAreaName,
      timestamp: now,
      isNightReport: SafetyStore.isNightTime(now),
      confirmations: 1,
      resolvedCount: 0
    };

    const all = this._load();
    all.push(report);
    this._save(all);

    // Record author vote so the author cannot confirm their own report
    const votes = this._readVotes();
    votes[newId] = "confirm";
    this._writeVotes(votes);

    return report;
  }

  /**
   * Adds a community confirmation vote (+1) if the browser has not already voted on this report.
   * @param {string} id - Report ID.
   * @returns {Object|null} Updated report or null if already voted or not found.
   */
  confirm(id) {
    const votes = this._readVotes();
    if (votes[id]) return null;

    const all = this._load();
    const target = all.find(r => r.id === id);
    if (!target) return null;

    target.confirmations += 1;
    this._save(all);

    votes[id] = "confirm";
    this._writeVotes(votes);

    return target;
  }

  /**
   * Increments the resolved count for a report. Hides it permanently once resolvedCount >= 3.
   * @param {string} id - Report ID.
   * @returns {Object|null} Updated report or null if already voted or not found.
   */
  resolve(id) {
    const votes = this._readVotes();
    if (votes[id]) return null;

    const all = this._load();
    const target = all.find(r => r.id === id);
    if (!target) return null;

    target.resolvedCount += 1;
    this._save(all);

    votes[id] = "resolve";
    this._writeVotes(votes);

    return target;
  }

  /**
   * Checks whether the current user's browser has already voted on this report.
   * @param {string} id - Report ID.
   * @returns {"confirm"|"resolve"|null} Vote type or null.
   */
  getVote(id) {
    const votes = this._readVotes();
    return votes[id] || null;
  }

  /**
   * Checks whether a report is stale (older than 14 days and has fewer than 3 confirmations).
   * @param {Object} report - SafetyReport object.
   * @returns {boolean} True if report needs re-confirmation.
   */
  isStale(report) {
    if (!report || typeof report.timestamp !== "number") return false;
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    const age = Date.now() - report.timestamp;
    return age > fourteenDaysMs && report.confirmations < 3;
  }

  /**
   * Resets all stored keys and re-populates the database with initial seed data.
   */
  reset() {
    try {
      localStorage.removeItem(this.storageKey);
      localStorage.removeItem(this.votesKey);
      localStorage.removeItem("jugnu_onboarded");
    } catch {
      // Ignore localStorage exceptions in restricted modes
    }
    this.memoryFallbackReports = null;
    this.memoryFallbackVotes = {};

    const fresh = SafetyStore.seedData();
    this._save(fresh);
    return fresh;
  }

  /**
   * Reads reports from localStorage with fallback to in-memory state.
   * @private
   */
  _load() {
    try {
      const dataStr = localStorage.getItem(this.storageKey);
      if (!dataStr) {
        return this.memoryFallbackReports || [];
      }
      return JSON.parse(dataStr);
    } catch {
      return this.memoryFallbackReports || [];
    }
  }

  /**
   * Saves reports to localStorage with fallback to in-memory state.
   * @private
   */
  _save(reports) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(reports));
    } catch {
      this.memoryFallbackReports = reports;
    }
  }

  /**
   * Reads vote map from localStorage with fallback to in-memory state.
   * @private
   */
  _readVotes() {
    try {
      const votesStr = localStorage.getItem(this.votesKey);
      if (!votesStr) return this.memoryFallbackVotes;
      return JSON.parse(votesStr);
    } catch {
      return this.memoryFallbackVotes;
    }
  }

  /**
   * Saves vote map to localStorage with fallback to in-memory state.
   * @private
   */
  _writeVotes(votes) {
    try {
      localStorage.setItem(this.votesKey, JSON.stringify(votes));
    } catch {
      this.memoryFallbackVotes = votes;
    }
  }
}
