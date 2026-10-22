/**
 * data.js - Safety Store & Data Layer for Jugnu
 * Integrates Supabase v2 Cloud Backend with offline LocalStorage fallback.
 *
 * SUPABASE DATABASE SETUP INSTRUCTIONS:
 * 1. Create a project at https://supabase.com
 * 2. In the Supabase SQL Editor, run the following script:
 *
 * --------------------------------------------------------------------------
 * create table if not exists public.reports (
 *   id uuid primary key default gen_random_uuid(),
 *   lat float8 not null,
 *   lng float8 not null,
 *   status text not null check (status in ('safe', 'caution', 'unsafe')),
 *   tags text[] default array[]::text[],
 *   note text default '',
 *   area_name text default '',
 *   timestamp bigint not null,
 *   confirmations int8 default 1,
 *   resolved_count int8 default 0,
 *   user_email text default null
 * );
 *
 * -- Enable Row Level Security (RLS)
 * alter table public.reports enable row level security;
 *
 * -- Allow public read access
 * create policy "Public reports are viewable by everyone"
 *   on public.reports for select using (true);
 *
 * -- Allow public insert access
 * create policy "Anyone can insert reports"
 *   on public.reports for insert with check (true);
 *
 * -- Allow public update access for community votes
 * create policy "Anyone can update report votes"
 *   on public.reports for update using (true);
 * --------------------------------------------------------------------------
 *
 * 3. Paste your Project URL and Anon Key into SUPABASE_CONFIG below.
 */
"use strict";

// Supabase Configuration
// Connected to live cloud backend
var SUPABASE_CONFIG = (typeof window !== "undefined" && window.SUPABASE_CONFIG) ? window.SUPABASE_CONFIG : {
  url: "https://jkcgqhxvofzhhzcyrketx.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprY2dxaHh2b2Z6aGh6Y3lrZXR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2MDUxODcsImV4cCI6MjEwODE4MTE4N30.tHe6q5y6eKPAEkJoJx7lBQ3nYgJkG7EJlISahsN5Z4U"
};

if (typeof window !== "undefined") {
  window.SUPABASE_CONFIG = SUPABASE_CONFIG;
}

class SafetyStore {
  /**
   * Initializes the safety store and Supabase client.
   * @param {string} storageKey - LocalStorage key for cached reports.
   */
  constructor(storageKey = "jugnu_reports_v1") {
    this.storageKey = storageKey;
    this.votesKey = "jugnu_votes";
    this.memoryFallbackReports = null;
    this.memoryFallbackVotes = {};
    this.client = null;
    this.cachedReports = [];

    // Initialize Supabase client if credentials are configured
    this._initClient();

    // Load initial cached reports or seed initial Mumbai dataset
    const existing = this._load();
    if (!existing || !Array.isArray(existing) || existing.length === 0) {
      const seeded = SafetyStore.seedData();
      this._save(seeded);
      this.cachedReports = seeded;
    } else {
      this.cachedReports = existing;
    }
  }

  /**
   * Initializes the Supabase client instance.
   * Checks window.SUPABASE_CONFIG, SUPABASE_CONFIG, or localStorage.
   * @private
   */
  _initClient() {
    try {
      if (typeof window.supabase === "undefined" || !window.supabase || typeof window.supabase.createClient !== "function") {
        return;
      }

      // Check runtime overrides or defaults
      const storedUrl = localStorage.getItem("jugnu_supabase_url");
      let storedKey = localStorage.getItem("jugnu_supabase_key");
      // Clear old legacy key or mismatched key to ensure anonymous key is cleanly initialized
      if (storedKey && (storedKey.startsWith("sb_publishable_") || storedKey === "your-anon-key" || storedKey !== SUPABASE_CONFIG.anonKey)) {
        try { localStorage.removeItem("jugnu_supabase_key"); } catch { }
        storedKey = null;
      }
      // Strictly enforce Supabase URL: clear any mismatched or outdated stored URL
      if (storedUrl && storedUrl !== SUPABASE_CONFIG.url) {
        try { localStorage.removeItem("jugnu_supabase_url"); } catch { }
      }

      const config = {
        url: SUPABASE_CONFIG.url,
        anonKey: storedKey || (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.anonKey) || SUPABASE_CONFIG.anonKey
      };

      // Ensure keys are not default placeholders
      const isPlaceholder = !config.url || !config.anonKey ||
        config.url.includes("your-project.supabase.co") ||
        config.anonKey === "your-anon-key";

      if (!isPlaceholder) {
        this.client = window.supabase.createClient(config.url, config.anonKey);
        window.supabaseClient = this.client;
        if (window.supabase && !window.supabase.auth) {
          window.supabase.auth = this.client.auth;
        }
      }
    } catch (err) {
      console.warn("Supabase client initialization skipped:", err);
      this.client = null;
    }
  }

  /**
   * Updates Supabase credentials at runtime and reconnects.
   * @param {string} url
   * @param {string} anonKey
   * @returns {boolean} True if successfully connected.
   */
  setCredentials(url, anonKey) {
    if (url) localStorage.setItem("jugnu_supabase_url", url.trim());
    if (anonKey) localStorage.setItem("jugnu_supabase_key", anonKey.trim());
    this._initClient();
    return this.isConfigured();
  }

  /**
   * Checks whether the Supabase client is actively configured.
   * @returns {boolean} True if client is ready.
   */
  isConfigured() {
    return this.client !== null;
  }

  /**
   * Returns the underlying Supabase client or null.
   * @returns {Object|null}
   */
  getClient() {
    return this.client;
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
        resolvedCount: item.resolvedCount,
        userEmail: null
      };
    });
  }

  /**
   * Maps a database row into the internal client representation.
   * @param {Object} row - Supabase row object.
   * @returns {Object} SafetyReport object.
   * @private
   */
  _fromDb(row) {
    const ts = Number(row.timestamp);
    return {
      id: String(row.id),
      lat: Number(row.lat),
      lng: Number(row.lng),
      status: row.status,
      tags: Array.isArray(row.tags) ? row.tags : [],
      note: row.note || "",
      areaName: row.area_name || row.areaName || "",
      timestamp: ts,
      isNightReport: SafetyStore.isNightTime(ts),
      confirmations: Number(row.confirmations || 1),
      resolvedCount: Number(row.resolved_count || row.resolvedCount || 0),
      userEmail: row.user_email || row.userEmail || null
    };
  }

  /**
   * Maps an internal report object into a Supabase database row.
   * @param {Object} report - Internal SafetyReport object.
   * @returns {Object} Database row representation.
   * @private
   */
  _toDb(report) {
    const payload = {
      lat: Number(report.lat),
      lng: Number(report.lng),
      status: report.status,
      tags: Array.isArray(report.tags) ? report.tags : [],
      note: report.note || "",
      area_name: report.areaName || "",
      timestamp: Number(report.timestamp),
      confirmations: Number(report.confirmations || 1),
      resolved_count: Number(report.resolvedCount || 0),
      user_email: report.userEmail || null
    };
    return payload;
  }

  /**
   * Fetches all reports from the Supabase reports table.
   * Falls back to local cached data if Supabase is offline or unconfigured.
   * @returns {Promise<Array<Object>>} List of reports.
   */
  async fetchReports() {
    if (!this.client) {
      this.cachedReports = this._load();
      return this.cachedReports;
    }

    try {
      const { data, error } = await this.client
        .from("reports")
        .select("*")
        .order("timestamp", { ascending: false });

      if (error) {
        console.warn("Supabase fetch error, using local data:", error.message);
        this.cachedReports = this._load();
        return this.cachedReports;
      }

      if (Array.isArray(data) && data.length > 0) {
        const mapped = data.map(row => this._fromDb(row));
        this.cachedReports = mapped;
        this._save(mapped);
        return mapped;
      }

      // If Supabase table is empty, load local data
      this.cachedReports = this._load();
      return this.cachedReports;
    } catch (err) {
      console.warn("Network error during Supabase fetch:", err);
      this.cachedReports = this._load();
      return this.cachedReports;
    }
  }

  /**
   * Validates and publishes a new safety report.
   * Inserts the report into Supabase if configured, and saves to local storage.
   * @param {Object} reportData - Fields: lat, lng, status, tags, note, areaName
   * @returns {Promise<Object>} The created SafetyReport object.
   */
  async addReport(reportData) {
    const { lat, lng, status, tags = [], note = "", areaName = "" } = reportData;

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

    const cleanTags = Array.isArray(tags)
      ? Array.from(new Set(tags.filter(t => typeof t === "string" && validVocabulary.includes(t.trim())))).slice(0, 6)
      : [];

    const cleanNote = typeof note === "string" ? note.trim().slice(0, 140) : "";
    const cleanAreaName = typeof areaName === "string" && areaName.trim().length > 0
      ? areaName.trim()
      : `Pinned location (${numericLat.toFixed(4)}, ${numericLng.toFixed(4)})`;

    const now = Date.now();
    const localId = "r_" + now.toString(36) + Math.random().toString(36).slice(2, 6);

    // Get current user email if signed in
    let userEmail = null;
    try {
      const user = await this.getCurrentUser();
      if (user && user.email) {
        userEmail = user.email;
      }
    } catch {
      // Continue without user email
    }

    const report = {
      id: localId,
      lat: Number(numericLat.toFixed(6)),
      lng: Number(numericLng.toFixed(6)),
      status: status,
      tags: cleanTags,
      note: cleanNote,
      areaName: cleanAreaName,
      timestamp: now,
      isNightReport: SafetyStore.isNightTime(now),
      confirmations: 1,
      resolvedCount: 0,
      userEmail: userEmail
    };

    // Attempt cloud insertion if Supabase client is available
    if (this.client) {
      try {
        const dbPayload = this._toDb(report);
        const { data, error } = await this.client
          .from("reports")
          .insert([dbPayload])
          .select();

        if (!error && Array.isArray(data) && data.length > 0) {
          const inserted = this._fromDb(data[0]);
          report.id = inserted.id;
        } else if (error) {
          console.warn("Supabase insert error, saved locally:", error.message);
        }
      } catch (err) {
        console.warn("Network error during Supabase insert:", err);
      }
    }

    // Update local cache and persistence
    const all = this._load();
    all.push(report);
    this._save(all);
    this.cachedReports = all;

    // Record author vote so the author cannot confirm their own report
    const votes = this._readVotes();
    votes[report.id] = "confirm";
    this._writeVotes(votes);

    return report;
  }

  /**
   * Backwards-compatible alias for addReport.
   * @param {Object} reportData
   * @returns {Promise<Object>}
   */
  async add(reportData) {
    return this.addReport(reportData);
  }

  /**
   * Increments the confirmation vote count for a report.
   * Saves to Supabase and updates local storage.
   * @param {string} id - Report ID.
   * @returns {Promise<Object|null>} Updated report or null if already voted or not found.
   */
  async upvoteReport(id) {
    const votes = this._readVotes();
    if (votes[id]) return null;

    const all = this._load();
    const target = all.find(r => r.id === id);
    if (!target) return null;

    target.confirmations += 1;

    // Push update to Supabase
    if (this.client) {
      try {
        await this.client
          .from("reports")
          .update({ confirmations: target.confirmations })
          .eq("id", id);
      } catch (err) {
        console.warn("Supabase confirmation update error:", err);
      }
    }

    this._save(all);
    this.cachedReports = all;

    votes[id] = "confirm";
    this._writeVotes(votes);

    return target;
  }

  /**
   * Backwards-compatible alias for upvoteReport.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async confirm(id) {
    return this.upvoteReport(id);
  }

  /**
   * Increments the resolved count for a report.
   * @param {string} id - Report ID.
   * @returns {Promise<Object|null>} Updated report or null.
   */
  async resolveReport(id) {
    const votes = this._readVotes();
    if (votes[id]) return null;

    const all = this._load();
    const target = all.find(r => r.id === id);
    if (!target) return null;

    target.resolvedCount += 1;

    // Push update to Supabase
    if (this.client) {
      try {
        await this.client
          .from("reports")
          .update({ resolved_count: target.resolvedCount })
          .eq("id", id);
      } catch (err) {
        console.warn("Supabase resolve update error:", err);
      }
    }

    this._save(all);
    this.cachedReports = all;

    votes[id] = "resolve";
    this._writeVotes(votes);

    return target;
  }

  /**
   * Backwards-compatible alias for resolveReport.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async resolve(id) {
    return this.resolveReport(id);
  }

  /* ==========================================================================
     Supabase Authentication Methods
     ========================================================================== */

  /**
   * Sends a magic link login email via Supabase Auth.
   * @param {string} email - Destination email address.
   * @returns {Promise<Object>} Supabase response.
   */
  async signInWithOtp(email) {
    if (!this.client) {
      throw new Error("Supabase is not configured yet. Please configure your project URL and Key in data.js.");
    }
    const { data, error } = await this.client.auth.signInWithOtp({
      email: email,
      options: {
        emailRedirectTo: window.location.origin + window.location.pathname
      }
    });
    if (error) throw error;
    return data;
  }

  /**
   * Signs in with email and password via Supabase Auth.
   * @param {string} email
   * @param {string} password
   * @returns {Promise<Object>} Supabase response.
   */
  async signInWithPassword(email, password) {
    if (!this.client) {
      throw new Error("Supabase is not configured yet. Please configure your project URL and Key in data.js.");
    }
    const { data, error } = await this.client.auth.signInWithPassword({
      email,
      password
    });
    if (error) throw error;
    return data;
  }

  /**
   * Signs up a new user with email and password via Supabase Auth.
   * @param {string} email
   * @param {string} password
   * @returns {Promise<Object>} Supabase response.
   */
  async signUpWithPassword(email, password) {
    if (!this.client) {
      throw new Error("Supabase is not configured yet. Please configure your project URL and Key in data.js.");
    }
    const { data, error } = await this.client.auth.signUp({
      email,
      password
    });
    if (error) throw error;
    return data;
  }

  /**
   * Signs out the current user session.
   * @returns {Promise<void>}
   */
  async signOut() {
    if (!this.client) return;
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
  }

  /**
   * Signs in using Google OAuth via Supabase Auth.
   * @returns {Promise<Object>} Supabase OAuth response.
   */
  async signInWithGoogle() {
    if (!this.client) {
      throw new Error("Supabase is not configured yet. Please configure your project URL and Key in data.js.");
    }
    const { data, error } = await this.client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin
      }
    });
    if (error) throw error;
    return data;
  }

  /**
   * Gets the active session from Supabase.
   * @returns {Promise<Object|null>} Active session or null.
   */
  async getSession() {
    if (!this.client) return null;
    try {
      const { data: { session } } = await this.client.auth.getSession();
      return session || null;
    } catch {
      return null;
    }
  }

  /**
   * Gets the currently authenticated user from Supabase.
   * @returns {Promise<Object|null>} Current user object or null.
   */
  async getCurrentUser() {
    if (!this.client) return null;
    try {
      const session = await this.getSession();
      if (session && session.user) {
        return session.user;
      }
      const { data: { user } } = await this.client.auth.getUser();
      return user || null;
    } catch {
      return null;
    }
  }

  /**
   * Subscribes to Supabase authentication state changes.
   * @param {Function} callback - (event, session) => void
   * @returns {Object|null} Subscription handle.
   */
  onAuthStateChange(callback) {
    if (!this.client) return null;
    try {
      const { data: { subscription } } = this.client.auth.onAuthStateChange(callback);
      return subscription;
    } catch {
      return null;
    }
  }

  /* ==========================================================================
     Synchronous Cache Read Methods
     ========================================================================== */

  /**
   * Retrieves all reports stored in local cache.
   * @returns {Array<Object>} All reports.
   */
  getAll() {
    if (this.cachedReports && this.cachedReports.length > 0) {
      return this.cachedReports;
    }
    return this._load();
  }

  /**
   * Returns active reports (resolvedCount < 3) filtered by the selected view mode.
   * @param {string} filter - "all" | "unsafe" | "caution" | "safe" | "night"
   * @returns {Array<Object>} Filtered list of visible reports.
   */
  getVisible(filter = "all") {
    const all = this.getAll();
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
    const all = this.getAll();
    return all.find(r => String(r.id) === String(id)) || null;
  }

  /**
   * Checks whether the current user has already voted on this report.
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
    this.cachedReports = fresh;
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
