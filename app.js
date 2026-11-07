/**
 * app.js - Main Application Controller for Jugnu
 * Handles Leaflet map interactions, search, filter states, reporting workflow,
 * verification votes, GPS geolocation, WhatsApp SOS, and fake exit call.
 */
"use strict";

document.addEventListener("DOMContentLoaded", () => {
  // Global Store Instance
  const store = new SafetyStore();

  // Application State
  const state = {
    map: null,
    reportLayer: null,
    targetMarker: null,
    userLocationMarker: null,
    userAccuracyCircle: null,
    searchRingMarker: null,
    markersById: {},
    currentFilter: "all",
    activeReportId: null,
    targetLatLng: null,
    selectedStatus: null,
    selectedChips: new Set(),
    isSubmitting: false,
    lastKnownPosition: null,
    watchId: null,
    searchAbortController: null,
    searchDebounceTimer: null,
    reverseGeocodeTimeout: null,
    // Fake call audio and timer state
    audioCtx: null,
    ringtoneOsc1: null,
    ringtoneOsc2: null,
    ringtoneGain: null,
    ringtoneInterval: null,
    callTimerInterval: null,
    callSeconds: 0,
    isCallPending: false,
    currentUser: null,
    pendingReportLatLng: null
  };

  // Inline SVG glyph paths for map pins (Lucide stroke format)
  const ICON_SVG = {
    "shield-check": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path>',
    "triangle-alert": '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
    "shield-alert": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>'
  };

  // Condition chip vocabularies paired with Lucide icon names
  const CONDITION_CHIPS = {
    safe: [
      { label: "Streetlights working", icon: "lightbulb" },
      { label: "Crowd around", icon: "users" },
      { label: "Shops open late", icon: "store" },
      { label: "Police / guard nearby", icon: "shield-check" },
      { label: "CCTV visible", icon: "cctv" },
      { label: "Pharmacy open 24x7", icon: "pill" }
    ],
    caution: [
      { label: "Dim / flickering lights", icon: "lightbulb-off" },
      { label: "Isolated after 10 PM", icon: "moon" },
      { label: "Stray dogs", icon: "dog" },
      { label: "No shops nearby", icon: "store" },
      { label: "Blocked footpath", icon: "footprints" },
      { label: "Poor visibility at turn", icon: "eye-off" }
    ],
    unsafe: [
      { label: "Pitch dark", icon: "lightbulb-off" },
      { label: "Broken streetlights", icon: "lightbulb-off" },
      { label: "Harassment reported", icon: "shield-alert" },
      { label: "Stalking reported", icon: "eye-off" },
      { label: "Isolated lane", icon: "moon" },
      { label: "Drunk groups", icon: "users" }
    ]
  };

  // Color mapping per safety level
  const LEVEL_COLORS = {
    safe: "#10B981",
    caution: "#F59E0B",
    unsafe: "#F43F5E"
  };

  /* ==========================================================================
     Section: Setup
     ========================================================================== */

  /**
   * Initializes the Leaflet map centered over Mumbai with OpenStreetMap tiles.
   */
  function initMap() {
    const mapElement = document.getElementById("map");
    if (!mapElement) return;

    state.map = L.map("map", {
      center: [19.0760, 72.8777],
      zoom: 14,
      zoomControl: false,
      preferCanvas: false // SVG rendering required for zone glow drop-shadow filters
    });

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
    }).addTo(state.map);

    state.reportLayer = L.layerGroup().addTo(state.map);

    // Map Click Handler for starting/moving reports or closing open sheets
    state.map.on("click", (e) => {
      onMapClick(e);
    });

    // Dynamic viewport bounds listener for live reports in view counter badge
    state.map.on("moveend", () => {
      updateReportsInViewCount();
    });
    state.map.on("zoomend", () => {
      updateReportsInViewCount();
    });
  }

  /**
   * Initializes UI elements and verifies URL query params (?reset=1).
   */
  function initUI() {
    // Check for reset query parameter
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("reset") === "1") {
      store.reset();
      showToast("Demo data re-seeded to initial Mumbai state.");
    }

    refreshIcons();
    maybeShowWelcome();

    // Initialize Supabase Auth Session
    checkAuthState();

    // Subscribe to Supabase Auth State Changes
    store.onAuthStateChange((event, session) => {
      updateAuthUI(session?.user || null);
      if (event === "SIGNED_IN" && session?.user) {
        const name = session.user.user_metadata?.full_name || session.user.email;
        showToast("Signed in as " + name);
      }
    });

    // Fetch reports asynchronously from Supabase Cloud
    store.fetchReports().then(() => {
      renderReports();
    }).catch(err => {
      console.warn("Initial Supabase reports fetch handled:", err);
    });
  }

  /**
   * Binds event listeners to interactive DOM elements.
   */
  function bindEvents() {
    // Full-Screen Immersive Landing Overlay Actions
    const btnLandingDismiss = document.getElementById("btn-landing-dismiss");
    if (btnLandingDismiss) {
      btnLandingDismiss.addEventListener("click", () => {
        dismissLandingOverlay(true);
      });
    }

    const btnLandingGoogleAuth = document.getElementById("btn-landing-google-auth");
    if (btnLandingGoogleAuth) {
      btnLandingGoogleAuth.addEventListener("click", () => {
        triggerGoogleAuth(btnLandingGoogleAuth);
      });
    }

    const btnLandingEmailAuth = document.getElementById("btn-landing-email-auth");
    if (btnLandingEmailAuth) {
      btnLandingEmailAuth.addEventListener("click", () => {
        dismissLandingOverlay(false);
        openSheet(document.getElementById("auth-modal"));
      });
    }

    // Top-Right About / Guide Button
    const btnOpenIntro = document.getElementById("btn-open-intro");
    if (btnOpenIntro) {
      btnOpenIntro.addEventListener("click", () => {
        showLandingOverlay();
      });
    }

    // Welcome Sheet Open Map Button (Legacy fallback)
    const btnOpenMap = document.getElementById("btn-open-map");
    if (btnOpenMap) {
      btnOpenMap.addEventListener("click", () => {
        dismissLandingOverlay();
      });
    }

    // Scrim Tap Dismisses Active Sheets
    const scrim = document.getElementById("scrim");
    if (scrim) {
      scrim.addEventListener("click", () => {
        closeAllOverlays();
      });
    }

    // Close Inspection Card Button
    const btnCloseInspect = document.getElementById("btn-close-inspect");
    if (btnCloseInspect) {
      btnCloseInspect.addEventListener("click", () => {
        closeInspect();
      });
    }

    // Inspection Card Confirm Button
    const btnConfirm = document.getElementById("btn-confirm");
    if (btnConfirm) {
      btnConfirm.addEventListener("click", () => {
        onConfirm();
      });
    }

    // Inspection Card Resolve Button
    const btnResolve = document.getElementById("btn-resolve");
    if (btnResolve) {
      btnResolve.addEventListener("click", () => {
        onResolve();
      });
    }

    // Close Report Sheet Button
    const btnCloseReport = document.getElementById("btn-close-report");
    if (btnCloseReport) {
      btnCloseReport.addEventListener("click", () => {
        closeReportSheet();
      });
    }

    // Safety Level Selection Buttons
    const statusBtns = document.querySelectorAll("#status-options .status-btn");
    statusBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const status = btn.getAttribute("data-status");
        selectStatus(status);
      });
    });

    // Note Input Character Counter
    const noteInput = document.getElementById("note-input");
    const noteCount = document.getElementById("note-count");
    if (noteInput && noteCount) {
      noteInput.addEventListener("input", () => {
        const len = noteInput.value.length;
        noteCount.textContent = `${len}/140`;
      });
    }

    // Publish Report Button
    const btnPublish = document.getElementById("btn-publish");
    if (btnPublish) {
      btnPublish.addEventListener("click", () => {
        publishReport();
      });
    }

    // Filter Bar Pills
    const filterPills = document.querySelectorAll("#filter-bar .pill");
    filterPills.forEach(pill => {
      pill.addEventListener("click", () => {
        const filter = pill.getAttribute("data-filter");
        setFilter(filter);
      });
    });

    // Search Input Form (Debounced live search + Form Submit)
    const searchForm = document.getElementById("search-form");
    const searchInput = document.getElementById("search-input");
    const searchClear = document.getElementById("search-clear");
    const searchResults = document.getElementById("search-results");

    if (searchForm && searchInput) {
      searchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        if (state.searchDebounceTimer) {
          clearTimeout(state.searchDebounceTimer);
          state.searchDebounceTimer = null;
        }
        const query = searchInput.value.trim();
        if (query.length > 0) {
          runSearch(query, false);
        }
      });

      searchInput.addEventListener("input", () => {
        const query = searchInput.value.trim();
        if (query.length > 0) {
          searchClear?.classList.remove("hidden");
        } else {
          searchClear?.classList.add("hidden");
        }

        if (state.searchDebounceTimer) {
          clearTimeout(state.searchDebounceTimer);
          state.searchDebounceTimer = null;
        }

        if (query.length >= 2) {
          state.searchDebounceTimer = setTimeout(() => {
            runSearch(query, true);
          }, 240);
        } else if (query.length === 0) {
          if (state.searchAbortController) {
            state.searchAbortController.abort();
            state.searchAbortController = null;
          }
          if (searchResults) {
            searchResults.innerHTML = "";
            searchResults.classList.add("hidden");
          }
        }
      });

      searchInput.addEventListener("focus", () => {
        const query = searchInput.value.trim();
        if (query.length >= 2 && searchResults && searchResults.children.length > 0) {
          searchResults.classList.remove("hidden");
        }
      });

      // Dismiss search dropdown when tapping outside
      document.addEventListener("click", (e) => {
        if (!searchForm.contains(e.target) && searchResults && !searchResults.classList.contains("hidden")) {
          searchResults.classList.add("hidden");
        }
      });
    }

    if (searchClear && searchInput) {
      searchClear.addEventListener("click", () => {
        if (state.searchDebounceTimer) {
          clearTimeout(state.searchDebounceTimer);
          state.searchDebounceTimer = null;
        }
        if (state.searchAbortController) {
          state.searchAbortController.abort();
          state.searchAbortController = null;
        }
        searchInput.value = "";
        searchClear.classList.add("hidden");
        if (searchResults) {
          searchResults.innerHTML = "";
          searchResults.classList.add("hidden");
        }
        searchInput.focus();
      });
    }

    // Desktop Zoom In & Out
    const btnZoomIn = document.getElementById("btn-zoom-in");
    const btnZoomOut = document.getElementById("btn-zoom-out");
    if (btnZoomIn && btnZoomOut) {
      btnZoomIn.addEventListener("click", () => {
        state.map?.zoomIn();
      });
      btnZoomOut.addEventListener("click", () => {
        state.map?.zoomOut();
      });
    }

    // Bottom Thumb Dock Buttons
    const btnLocate = document.getElementById("btn-locate");
    if (btnLocate) {
      btnLocate.addEventListener("click", () => {
        locateMe();
      });
    }

    const btnReport = document.getElementById("btn-report");
    if (btnReport) {
      btnReport.addEventListener("click", () => {
        if (state.lastKnownPosition) {
          placeTarget(state.lastKnownPosition);
        } else if (state.map) {
          placeTarget(state.map.getCenter());
        }
      });
    }

    const btnExitCall = document.getElementById("btn-exit-call");
    if (btnExitCall) {
      btnExitCall.addEventListener("click", () => {
        startFakeCall();
      });
    }

    const btnSos = document.getElementById("btn-sos");
    if (btnSos) {
      btnSos.addEventListener("click", () => {
        sendSos();
      });
    }

    // Fake Call Screen Buttons
    const btnDecline = document.getElementById("btn-decline");
    if (btnDecline) {
      btnDecline.addEventListener("click", () => {
        endCall();
      });
    }

    const btnAnswer = document.getElementById("btn-answer");
    if (btnAnswer) {
      btnAnswer.addEventListener("click", () => {
        answerCall();
      });
    }

    const btnEndCall = document.getElementById("btn-end-call");
    if (btnEndCall) {
      btnEndCall.addEventListener("click", () => {
        endCall();
      });
    }

    // Decorative Call Toggles (Mute, Keypad, Speaker)
    const toggleBtns = document.querySelectorAll(".call-toggle-btn");
    toggleBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        btn.classList.toggle("is-active");
      });
    });

    // Authentication & Cloud Sync Modal Triggers
    const btnAccount = document.getElementById("btn-account");
    if (btnAccount) {
      btnAccount.addEventListener("click", () => {
        showAuthModal();
      });
    }

    const btnCloseAuth = document.getElementById("btn-close-auth");
    if (btnCloseAuth) {
      btnCloseAuth.addEventListener("click", () => {
        closeSheet(document.getElementById("auth-modal"));
      });
    }

    // Google OAuth Sign In Button in Auth Modal
    const btnGoogleAuth = document.getElementById("btn-google-auth");
    if (btnGoogleAuth) {
      btnGoogleAuth.addEventListener("click", () => {
        triggerGoogleAuth(btnGoogleAuth);
      });
    }

    // Auth Form Submission (Direct Email & Password Sign In)
    const authForm = document.getElementById("auth-form");
    if (authForm) {
      authForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const emailInput = document.getElementById("auth-email");
        const passInput = document.getElementById("auth-password");
        const email = emailInput ? emailInput.value.trim() : "";
        const password = passInput ? passInput.value : "";

        if (!email || !password) {
          showToast("Please enter both email and password.");
          return;
        }

        if (!store.isConfigured()) {
          showToast("Supabase is not configured. Please paste your active Supabase URL and Anon Key in Cloud Connection Settings below.");
          const detailsEl = document.querySelector(".auth-advanced-details");
          if (detailsEl) detailsEl.open = true;
          const urlInput = document.getElementById("cfg-supabase-url");
          if (urlInput) urlInput.focus();
          return;
        }

        const submitBtn = document.getElementById("btn-auth-submit");
        if (submitBtn) submitBtn.disabled = true;

        try {
          await store.signInWithPassword(email, password);
          showToast("Signed in successfully.");
          const user = await store.getCurrentUser();
          updateAuthUI(user);
          closeSheet(document.getElementById("auth-modal"));
        } catch (signInErr) {
          showToast(signInErr.message || "Invalid credentials. Try Create Account if you are new.");
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }

    // Create Account Button (Direct Sign Up with Email & Password)
    const btnAuthSignup = document.getElementById("btn-auth-signup");
    if (btnAuthSignup) {
      btnAuthSignup.addEventListener("click", async () => {
        const emailInput = document.getElementById("auth-email");
        const passInput = document.getElementById("auth-password");
        const email = emailInput ? emailInput.value.trim() : "";
        const password = passInput ? passInput.value : "";

        if (!email || !password) {
          showToast("Please enter both email and password to create an account.");
          return;
        }

        if (!store.isConfigured()) {
          showToast("Supabase is not configured. Please paste your active Supabase URL and Anon Key in Cloud Connection Settings below.");
          const detailsEl = document.querySelector(".auth-advanced-details");
          if (detailsEl) detailsEl.open = true;
          const urlInput = document.getElementById("cfg-supabase-url");
          if (urlInput) urlInput.focus();
          return;
        }

        btnAuthSignup.disabled = true;
        try {
          await store.signUpWithPassword(email, password);
          showToast("Account created successfully. Check your email or sign in.");
          const user = await store.getCurrentUser();
          if (user) {
            updateAuthUI(user);
            closeSheet(document.getElementById("auth-modal"));
          }
        } catch (err) {
          showToast(err.message || "Sign up failed.");
        } finally {
          btnAuthSignup.disabled = false;
        }
      });
    }

    // Custom Supabase Key & URL Reconnection
    const cfgUrlInput = document.getElementById("cfg-supabase-url");
    const cfgKeyInput = document.getElementById("cfg-supabase-key");
    if (cfgUrlInput) {
      const currentUrl = store.getUrl();
      if (currentUrl && !currentUrl.includes("your-project") && !currentUrl.includes("jkcgqhxvofzhhzcyrketx")) {
        cfgUrlInput.value = currentUrl;
      }
    }
    if (cfgKeyInput) {
      const currentKey = store.getKey();
      if (currentKey && currentKey !== "your-anon-key") {
        cfgKeyInput.value = currentKey;
      }
    }

    const btnSaveKey = document.getElementById("btn-save-key");
    if (btnSaveKey) {
      btnSaveKey.addEventListener("click", async () => {
        const customUrl = cfgUrlInput ? cfgUrlInput.value.trim() : "";
        const customKey = cfgKeyInput ? cfgKeyInput.value.trim() : "";
        if (!customUrl && (!store.getUrl() || store.getUrl().includes("your-project"))) {
          showToast("Please enter your active Supabase Project URL.");
          return;
        }
        if (!customKey || customKey === "your-anon-key") {
          showToast("Please enter a valid Supabase Anon Key or JWT.");
          return;
        }
        const connected = store.setCredentials(customUrl || null, customKey);
        if (!connected) {
          showToast("Please verify your Supabase URL and Anon Key.");
          return;
        }
        showToast("Cloud credentials updated. Reconnecting to Supabase...");
        try {
          await store.fetchReports();
          renderReports();
          const user = await store.getCurrentUser();
          updateAuthUI(user);
          showToast("Connected to Supabase Cloud.");
        } catch (err) {
          showToast("Supabase connection: " + err.message);
        }
      });
    }

    // Sign Out Button
    const btnSignOut = document.getElementById("btn-sign-out");
    if (btnSignOut) {
      btnSignOut.addEventListener("click", async () => {
        try {
          await store.signOut();
          updateAuthUI(null);
          showToast("Signed out successfully.");
          closeSheet(document.getElementById("auth-modal"));
        } catch (err) {
          showToast("Sign out error: " + err.message);
        }
      });
    }

    // Continue as Guest Button
    const btnContinueGuest = document.getElementById("btn-continue-guest");
    if (btnContinueGuest) {
      btnContinueGuest.addEventListener("click", () => {
        state.pendingReportLatLng = null;
        closeSheet(document.getElementById("auth-modal"));
        showToast("Continuing as guest in local offline mode.");
      });
    }

    // Global Keydown (Escape closes top sheet)
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!document.getElementById("call-screen")?.classList.contains("hidden")) {
          endCall();
        } else {
          closeAllOverlays();
        }
      }
    });
  }

  /**
   * Initiates Google OAuth authentication via Supabase.
   * @param {HTMLButtonElement|null} triggerBtn - The button that triggered auth.
   */
  async function triggerGoogleAuth(triggerBtn) {
    if (!store.isConfigured()) {
      showToast("Supabase is not configured. Please paste your active Supabase URL and Anon Key in Cloud Connection Settings.");
      dismissLandingOverlay(false);
      openSheet(document.getElementById("auth-modal"));
      const detailsEl = document.querySelector(".auth-advanced-details");
      if (detailsEl) detailsEl.open = true;
      const urlInput = document.getElementById("cfg-supabase-url");
      if (urlInput) urlInput.focus();
      return;
    }
    if (triggerBtn) triggerBtn.disabled = true;
    try {
      if (store && typeof store.signInWithGoogle === "function") {
        await store.signInWithGoogle();
      } else if (window.supabaseClient?.auth) {
        const { error } = await window.supabaseClient.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: window.location.origin
          }
        });
        if (error) throw error;
      } else if (window.supabase?.auth) {
        const { error } = await window.supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: window.location.origin
          }
        });
        if (error) throw error;
      }
    } catch (err) {
      showToast(err.message || "Google sign in failed.");
      if (triggerBtn) triggerBtn.disabled = false;
    }
  }

  /**
   * Displays the Animated Intro & Landing Frontpage Overlay automatically by default
   * on DOMContentLoaded (unless sessionStorage.getItem('landing_dismissed') is set).
   */
  function maybeShowWelcome() {
    let isDismissed = false;
    try {
      isDismissed = sessionStorage.getItem("landing_dismissed") === "true";
    } catch {
      isDismissed = false;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const forceIntro = urlParams.get("intro") === "1" || urlParams.get("about") === "1" || urlParams.get("welcome") === "1";

    const overlay = document.getElementById("landing-overlay");
    if (!overlay) return;

    if (!isDismissed || forceIntro) {
      showLandingOverlay();
    } else {
      overlay.classList.add("hidden");
      overlay.classList.remove("active", "is-open");
      overlay.style.display = "none";
    }
  }

  /**
   * Smoothly displays the Animated Intro & Landing Frontpage Overlay.
   */
  function showLandingOverlay() {
    const overlay = document.getElementById("landing-overlay");
    if (!overlay) return;
    overlay.style.display = "flex";
    overlay.classList.remove("hidden");
    overlay.classList.remove("is-closing");
    overlay.classList.add("active");
    overlay.classList.add("is-open");
    void overlay.offsetWidth;
    refreshIcons();
  }

  /**
   * Smoothly dismisses the Animated Intro & Landing Frontpage Overlay.
   * If explored is true ("Explore Live Map" clicked), records landing_dismissed in sessionStorage
   * so it does not pop up again on refresh during this browser session.
   * @param {boolean} explored - Whether the dismissal was triggered by "Explore Live Map".
   */
  function dismissLandingOverlay(explored = false) {
    if (explored) {
      try {
        sessionStorage.setItem("landing_dismissed", "true");
        sessionStorage.setItem("jugnu_landing_explored", "true");
        localStorage.setItem("jugnu_landing_seen", "1");
        localStorage.setItem("jugnu_onboarded", "1");
      } catch {
        // Ignore storage restrictions
      }
    }

    const overlay = document.getElementById("landing-overlay");
    if (overlay) {
      overlay.classList.add("is-closing");
      setTimeout(() => {
        overlay.classList.remove("is-closing");
        overlay.classList.remove("active");
        overlay.classList.remove("is-open");
        overlay.classList.add("hidden");
        overlay.style.display = "none";
        // Reveal map seamlessly by recalculating Leaflet viewport dimensions
        if (state.map) {
          state.map.invalidateSize();
        }
      }, 300);
    }

    const legacySheet = document.getElementById("welcome-sheet");
    if (legacySheet && !legacySheet.classList.contains("hidden")) {
      closeSheet(legacySheet);
    }
  }

  /**
   * Opens the Auth Modal, optionally showing an intercept guard notice.
   * @param {string|null} noticeMessage - Optional notice text to display.
   */
  function showAuthModal(noticeMessage = null) {
    const noticeEl = document.getElementById("auth-guard-notice");
    const noticeText = document.getElementById("auth-notice-text");

    if (noticeMessage) {
      if (noticeText) noticeText.textContent = noticeMessage;
      if (noticeEl) noticeEl.classList.remove("hidden");
    } else {
      if (noticeEl) noticeEl.classList.add("hidden");
    }

    openSheet(document.getElementById("auth-modal"));
  }

  /**
   * Updates UI based on user authentication state.
   * @param {Object|null} user - Supabase user object or null.
   */
  function updateAuthUI(user) {
    state.currentUser = user;
    const authUserView = document.getElementById("auth-user-view");
    const authLoginView = document.getElementById("auth-login-view");
    const accountLabel = document.getElementById("account-label");
    const accountAvatar = document.getElementById("account-avatar");
    const authUserEmail = document.getElementById("auth-user-email");
    const authAvatarInitials = document.getElementById("auth-avatar-initials");
    const authUserName = document.getElementById("auth-user-name");
    const btnLandingGoogle = document.getElementById("btn-landing-google-auth");

    if (user && user.email) {
      if (authUserView) authUserView.classList.remove("hidden");
      if (authLoginView) authLoginView.classList.add("hidden");

      const fullName = user.user_metadata?.full_name || user.user_metadata?.name || "";
      const email = user.email;
      const initial = (fullName ? fullName.charAt(0) : email.charAt(0)).toUpperCase();
      const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || null;

      if (authUserName) {
        authUserName.textContent = fullName || email.split("@")[0];
      }
      if (authUserEmail) {
        authUserEmail.textContent = email;
      }
      if (authAvatarInitials) {
        if (avatarUrl) {
          authAvatarInitials.innerHTML = `<img src="${avatarUrl}" alt="${initial}" class="auth-avatar-img">`;
        } else {
          authAvatarInitials.textContent = initial;
        }
      }

      const displayLabel = fullName ? fullName.split(" ")[0] : email.split("@")[0];
      if (accountLabel) accountLabel.textContent = displayLabel;
      if (accountAvatar) {
        if (avatarUrl) {
          accountAvatar.innerHTML = `<img src="${avatarUrl}" alt="${initial}" class="account-avatar-img">`;
        } else {
          accountAvatar.innerHTML = `<div class="account-avatar-badge">${initial}</div>`;
        }
      }

      if (btnLandingGoogle) {
        btnLandingGoogle.innerHTML = `<i data-lucide="shield-check"></i><span>Signed in (${escapeHtml(displayLabel)})</span>`;
        btnLandingGoogle.style.background = "rgba(16, 185, 129, 0.15)";
        btnLandingGoogle.style.color = "#34D399";
        btnLandingGoogle.style.borderColor = "rgba(16, 185, 129, 0.4)";
      }

      // If user was prompted to sign in to drop a pin, resume pin placement
      if (state.pendingReportLatLng) {
        const pending = state.pendingReportLatLng;
        state.pendingReportLatLng = null;
        closeSheet(document.getElementById("auth-modal"));
        setTimeout(() => {
          placeTarget(pending);
          showToast("Signed in. You can now publish your safety report.");
        }, 320);
      }
    } else {
      if (authUserView) authUserView.classList.add("hidden");
      if (authLoginView) authLoginView.classList.remove("hidden");

      if (accountLabel) accountLabel.textContent = "Sign In";
      if (accountAvatar) {
        accountAvatar.innerHTML = '<i data-lucide="user"></i>';
      }

      if (btnLandingGoogle) {
        btnLandingGoogle.innerHTML = `<svg class="google-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg><span>Continue with Google</span>`;
        btnLandingGoogle.style.background = "";
        btnLandingGoogle.style.color = "";
        btnLandingGoogle.style.borderColor = "";
      }
      refreshIcons();
    }
  }

  /**
   * Checks initial authentication session from Supabase on startup.
   */
  async function checkAuthState() {
    try {
      const user = await store.getCurrentUser();
      updateAuthUI(user);
    } catch {
      updateAuthUI(null);
    }
  }

  /* ==========================================================================
     Section: Rendering
     ========================================================================== */

  /**
   * Renders report markers and safety zones to the map according to the current filter.
   */
  function renderReports() {
    if (!state.reportLayer) return;

    state.reportLayer.clearLayers();
    state.markersById = {};

    const reports = store.getVisible(state.currentFilter);

    if (reports.length === 0) {
      showToast("No reports match this filter here.");
      updateReportsInViewCount();
      return;
    }

    // Sort order for circles: safe first, then caution, then unsafe (so unsafe glow is never occluded)
    const order = { safe: 1, caution: 2, unsafe: 3 };
    const sortedForCircles = [...reports].sort((a, b) => (order[a.status] || 0) - (order[b.status] || 0));

    // Render 120m radius circles
    sortedForCircles.forEach(report => {
      const circle = buildZone(report);
      circle.addTo(state.reportLayer);
    });

    // Render pins
    reports.forEach(report => {
      const dim = store.isStale(report);
      const icon = buildPinIcon(report.status, dim);
      const marker = L.marker([report.lat, report.lng], { icon: icon });

      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        openInspect(report.id);
      });

      marker.addTo(state.reportLayer);
      state.markersById[report.id] = marker;
    });

    updateReportsInViewCount();
  }

  /**
   * Recalculates and updates the live count of reports currently within map viewport bounds.
   */
  function updateReportsInViewCount() {
    const badgeText = document.getElementById("reports-count-text");
    if (!badgeText || !state.map) return;

    const bounds = state.map.getBounds();
    const visibleReports = store.getVisible(state.currentFilter);
    let countInView = 0;

    visibleReports.forEach(report => {
      if (bounds.contains([report.lat, report.lng])) {
        countInView++;
      }
    });

    const label = countInView === 1 ? "1 active safety report in view" : `${countInView} active safety reports in view`;
    badgeText.textContent = label;
  }

  /**
   * Builds an L.divIcon with custom inline teardrop SVG and animated pulse ring.
   * @param {string} status - "safe" | "caution" | "unsafe"
   * @param {boolean} dim - Stale state flag.
   * @returns {L.DivIcon} Leaflet DivIcon.
   */
  function buildPinIcon(status, dim = false) {
    const color = LEVEL_COLORS[status] || LEVEL_COLORS.safe;
    const glyphSvg = ICON_SVG[status === "safe" ? "shield-check" : (status === "caution" ? "triangle-alert" : "shield-alert")] || "";

    const pulseHtml = status === "unsafe"
      ? '<div class="pin-pulse pin-pulse-unsafe"></div>'
      : (status === "caution" ? '<div class="pin-pulse pin-pulse-caution"></div>' : '');

    const dimStyle = dim ? 'style="opacity: 0.55;"' : '';
    const unsafeClass = status === "unsafe" ? "jugnu-pin-wrap-unsafe" : "";

    const html = `
      <div class="jugnu-pin-wrap ${unsafeClass}" ${dimStyle}>
        ${pulseHtml}
        <svg class="jugnu-pin" width="40" height="48" viewBox="0 0 40 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 47C20 47 38 29.5 38 18C38 8.05887 29.9411 0 20 0C10.0589 0 2 8.05887 2 18C2 29.5 20 47 20 47Z" fill="${color}"/>
          <g transform="translate(8, 6)" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">
            ${glyphSvg}
          </g>
        </svg>
      </div>
    `;

    return L.divIcon({
      className: "custom-pin-icon",
      html: html,
      iconSize: [40, 48],
      iconAnchor: [20, 48]
    });
  }

  /**
   * Builds an L.circle representing the 120-meter safety zone around a report.
   * @param {Object} report - SafetyReport.
   * @returns {L.Circle} Leaflet Circle.
   */
  function buildZone(report) {
    const color = LEVEL_COLORS[report.status] || LEVEL_COLORS.safe;
    const isStale = store.isStale(report);
    const fillOpacity = isStale ? 0.09 : 0.18;

    return L.circle([report.lat, report.lng], {
      radius: 120,
      color: color,
      weight: 2,
      opacity: 0.9,
      fillColor: color,
      fillOpacity: fillOpacity,
      interactive: false,
      className: "zone zone-" + report.status
    });
  }

  /**
   * Updates the active filter pill and re-renders visible reports.
   * @param {string} filter - "all" | "unsafe" | "caution" | "safe" | "night"
   */
  function setFilter(filter) {
    state.currentFilter = filter;

    const pills = document.querySelectorAll("#filter-bar .pill");
    pills.forEach(pill => {
      if (pill.getAttribute("data-filter") === filter) {
        pill.classList.add("is-active");
      } else {
        pill.classList.remove("is-active");
      }
    });

    closeInspect();
    renderReports();
  }

  /* ==========================================================================
     Section: Inspect (Community Verification)
     ========================================================================== */

  /**
   * Opens the inspection card for a selected report.
   * @param {string} id - Report ID.
   */
  function openInspect(id) {
    const report = store.getById(id);
    if (!report) return;

    state.activeReportId = id;
    closeReportSheet();

    const inspectCard = document.getElementById("inspect-card");
    const areaEl = document.getElementById("inspect-area");
    const badgeEl = document.getElementById("inspect-badge");
    const daynightEl = document.getElementById("inspect-daynight");
    const tagsEl = document.getElementById("inspect-tags");
    const noteEl = document.getElementById("inspect-note");
    const timeEl = document.getElementById("inspect-time");
    const trustEl = document.getElementById("inspect-trust");

    if (!inspectCard) return;

    // Set text contents safely
    if (areaEl) areaEl.textContent = report.areaName;

    if (badgeEl) {
      badgeEl.className = "inspect-badge inspect-badge-" + report.status;
      const statusTitle = report.status === "safe" ? "Safe & Well-Lit" : (report.status === "caution" ? "Caution / Dim" : "Unsafe / Avoid");
      badgeEl.textContent = statusTitle;
    }

    if (daynightEl) {
      const isNight = report.isNightReport;
      daynightEl.innerHTML = `
        <i data-lucide="${isNight ? 'moon' : 'sun'}"></i>
        <span>${isNight ? 'Night report' : 'Day report'}</span>
      `;
    }

    if (tagsEl) {
      tagsEl.innerHTML = "";
      if (Array.isArray(report.tags) && report.tags.length > 0) {
        report.tags.forEach(t => {
          const chip = document.createElement("span");
          chip.className = "inspect-tag-chip";
          chip.textContent = t;
          tagsEl.appendChild(chip);
        });
      }
    }

    if (noteEl) {
      if (report.note && report.note.length > 0) {
        noteEl.textContent = report.note;
        noteEl.classList.remove("hidden");
      } else {
        noteEl.textContent = "";
        noteEl.classList.add("hidden");
      }
    }

    if (timeEl) {
      const rel = relativeTime(report.timestamp);
      const exact = formatClock(report.timestamp);
      timeEl.textContent = `Reported ${rel} (${exact})`;
    }

    if (trustEl) {
      const isStale = store.isStale(report);
      let trustHtml = `<span>Confirmed by ${report.confirmations} women</span>`;

      if (report.confirmations >= 5) {
        trustHtml += `
          <span class="verified-badge">
            <i data-lucide="badge-check"></i>
            <span>Community verified</span>
          </span>
        `;
      }

      if (isStale) {
        trustHtml += `
          <span class="stale-badge">
            <i data-lucide="triangle-alert"></i>
            <span>Needs re-confirmation</span>
          </span>
        `;
      }

      trustEl.innerHTML = trustHtml;
    }

    updateInspectButtons(report);
    openSheet(inspectCard);
    refreshIcons();
  }

  /**
   * Closes the inspection card.
   */
  function closeInspect() {
    state.activeReportId = null;
    const inspectCard = document.getElementById("inspect-card");
    if (inspectCard) {
      closeSheet(inspectCard);
    }
  }

  /**
   * Handles user tapping "Confirm Still True (+1)".
   */
  async function onConfirm() {
    if (!state.activeReportId) return;

    const id = state.activeReportId;
    const updated = await store.upvoteReport(id);
    if (!updated) {
      showToast("You have already voted on this report.");
      return;
    }

    showToast("Thanks. Confirmation added.");
    openInspect(id);
    renderReports();
  }

  /**
   * Handles user tapping "Mark Resolved".
   */
  async function onResolve() {
    if (!state.activeReportId) return;

    const id = state.activeReportId;
    const updated = await store.resolveReport(id);
    if (!updated) {
      showToast("You have already voted on this report.");
      return;
    }

    if (updated.resolvedCount >= 3) {
      showToast("Enough women confirmed this is resolved. Report removed.");
      closeInspect();
      renderReports();
    } else {
      showToast(`Thanks. Marked as resolved (${updated.resolvedCount} of 3).`);
      openInspect(id);
      renderReports();
    }
  }

  /**
   * Updates state and disabled status of inspection card buttons according to user vote.
   * @param {Object} report - SafetyReport.
   */
  function updateInspectButtons(report) {
    const btnConfirm = document.getElementById("btn-confirm");
    const btnResolve = document.getElementById("btn-resolve");
    if (!btnConfirm || !btnResolve) return;

    const vote = store.getVote(report.id);

    // Reset button states
    btnConfirm.disabled = false;
    btnResolve.disabled = false;
    btnConfirm.classList.remove("is-voted");
    btnResolve.classList.remove("is-voted");

    btnConfirm.innerHTML = `<i data-lucide="check"></i><span>Confirm Still True (+1)</span>`;
    btnResolve.innerHTML = `<i data-lucide="badge-check"></i><span>Mark Resolved</span>`;

    if (vote === "confirm") {
      btnConfirm.disabled = true;
      btnResolve.disabled = true;
      btnConfirm.classList.add("is-voted");
      btnConfirm.innerHTML = `<i data-lucide="check"></i><span>You confirmed</span>`;
    } else if (vote === "resolve") {
      btnConfirm.disabled = true;
      btnResolve.disabled = true;
      btnResolve.classList.add("is-voted");
      btnResolve.innerHTML = `<i data-lucide="check"></i><span>Marked resolved</span>`;
    }
  }

  /* ==========================================================================
     Section: Report Flow
     ========================================================================== */

  /**
   * Handles user clicks on the Leaflet map.
   * @param {Object} e - Leaflet Map click event.
   */
  function onMapClick(e) {
    const reportSheet = document.getElementById("report-sheet");
    const inspectCard = document.getElementById("inspect-card");

    // If inspect card is open, map click simply closes it
    if (inspectCard && inspectCard.classList.contains("is-open")) {
      closeInspect();
      return;
    }

    // If report sheet is already open, click repositions target ring
    if (reportSheet && reportSheet.classList.contains("is-open")) {
      placeTarget(e.latlng);
      return;
    }

    // Otherwise, start a new report at the tapped spot
    placeTarget(e.latlng);
  }

  /**
   * Drops the amber target ring marker at latlng and opens the Report Sheet.
   * Requires user to be authenticated before opening the report sheet.
   * @param {L.LatLng|Object} latlng - Target coordinates.
   */
  async function placeTarget(latlng) {
    // Authentication Guard for Pin Reporting: verify active session or current user
    let user = state.currentUser;
    if (!user) {
      user = await store.getCurrentUser();
      if (user) {
        state.currentUser = user;
        updateAuthUI(user);
      }
    }

    if (!user) {
      const lat = typeof latlng.lat === "number" ? latlng.lat : latlng[0];
      const lng = typeof latlng.lng === "number" ? latlng.lng : latlng[1];
      state.pendingReportLatLng = { lat, lng };

      showAuthModal("Please sign in or create an account to report safety incidents to the community.");
      return;
    }

    const lat = typeof latlng.lat === "number" ? latlng.lat : latlng[0];
    const lng = typeof latlng.lng === "number" ? latlng.lng : latlng[1];

    state.targetLatLng = { lat, lng };

    // Remove existing target marker if any
    if (state.targetMarker && state.map) {
      state.map.removeLayer(state.targetMarker);
    }

    // Target ring marker
    const targetHtml = `
      <div class="target-ring-container">
        <div class="target-ring-circle"></div>
        <div class="target-ring-dot"></div>
      </div>
    `;

    const targetIcon = L.divIcon({
      className: "target-div-icon",
      html: targetHtml,
      iconSize: [56, 56],
      iconAnchor: [28, 28]
    });

    state.targetMarker = L.marker([lat, lng], { icon: targetIcon, interactive: false }).addTo(state.map);

    // Pan map so target sits in upper 30% of screen above sheet
    if (state.map) {
      const targetPoint = state.map.latLngToContainerPoint([lat, lng]);
      const screenH = window.innerHeight;
      const targetOffsetY = Math.round(screenH * 0.28);
      const newCenterPoint = L.point(targetPoint.x, targetPoint.y + (screenH / 2 - targetOffsetY));
      const newLatLng = state.map.containerPointToLatLng(newCenterPoint);
      state.map.panTo(newLatLng, { animate: true, duration: 0.6 });
    }

    openReportSheet();

    // Debounce reverse geocoding request (800ms)
    if (state.reverseGeocodeTimeout) {
      clearTimeout(state.reverseGeocodeTimeout);
    }
    state.reverseGeocodeTimeout = setTimeout(() => {
      reverseGeocode({ lat, lng });
    }, 800);
  }

  /**
   * Reverse geocodes the target coordinates using OpenStreetMap Nominatim API.
   * @param {Object} coords - { lat, lng }
   */
  async function reverseGeocode({ lat, lng }) {
    const areaEl = document.getElementById("report-area");
    if (!areaEl) return;

    areaEl.textContent = "Finding street name...";

    const fallback = `Pinned location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
      const res = await fetch(url, { headers: { "Accept-Language": "en" } });
      if (!res.ok) throw new Error("Geocoding failed");

      const data = await res.json();
      if (data && data.display_name) {
        const parts = data.display_name.split(",").map(p => p.trim());
        const shortName = parts.slice(0, 3).join(", ");
        areaEl.textContent = shortName || fallback;
      } else {
        areaEl.textContent = fallback;
      }
    } catch {
      areaEl.textContent = fallback;
    }
  }

  /**
   * Opens the Report Sheet and resets form input fields.
   */
  function openReportSheet() {
    closeInspect();
    const sheet = document.getElementById("report-sheet");
    if (!sheet) return;

    // Reset form state
    state.selectedStatus = null;
    state.selectedChips.clear();

    const noteInput = document.getElementById("note-input");
    const noteCount = document.getElementById("note-count");
    if (noteInput) noteInput.value = "";
    if (noteCount) noteCount.textContent = "0/140";

    const statusBtns = document.querySelectorAll("#status-options .status-btn");
    statusBtns.forEach(btn => {
      btn.classList.remove("is-selected");
      btn.setAttribute("aria-checked", "false");
    });

    const chipGroup = document.getElementById("chip-group");
    if (chipGroup) {
      chipGroup.innerHTML = '<p class="chip-placeholder">Select a safety level above to choose conditions.</p>';
    }

    updatePublishState();
    openSheet(sheet);
    refreshIcons();
  }

  /**
   * Closes the Report Sheet and removes the target placement marker.
   */
  function closeReportSheet() {
    const sheet = document.getElementById("report-sheet");
    if (sheet) {
      closeSheet(sheet);
    }
    if (state.targetMarker && state.map) {
      state.map.removeLayer(state.targetMarker);
      state.targetMarker = null;
    }
    state.targetLatLng = null;
  }

  /**
   * Selects a safety level ("safe", "caution", "unsafe") and renders corresponding condition chips.
   * @param {string} status - Selected status.
   */
  function selectStatus(status) {
    state.selectedStatus = status;
    state.selectedChips.clear();

    const statusBtns = document.querySelectorAll("#status-options .status-btn");
    statusBtns.forEach(btn => {
      const match = btn.getAttribute("data-status") === status;
      btn.classList.toggle("is-selected", match);
      btn.setAttribute("aria-checked", match ? "true" : "false");
    });

    renderChips(status);
    updatePublishState();
  }

  /**
   * Renders the dynamic condition chips corresponding to the selected level.
   * @param {string} status - "safe" | "caution" | "unsafe"
   */
  function renderChips(status) {
    const chipGroup = document.getElementById("chip-group");
    if (!chipGroup) return;

    chipGroup.innerHTML = "";
    const list = CONDITION_CHIPS[status] || [];

    list.forEach(item => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "condition-chip";
      chip.innerHTML = `
        <i data-lucide="${item.icon}"></i>
        <span>${item.label}</span>
      `;

      chip.addEventListener("click", () => {
        toggleChip(item.label);
        chip.classList.toggle("is-selected", state.selectedChips.has(item.label));
      });

      chipGroup.appendChild(chip);
    });

    refreshIcons();
  }

  /**
   * Toggles the selection of an individual condition chip.
   * @param {string} label - Condition label.
   */
  function toggleChip(label) {
    if (state.selectedChips.has(label)) {
      state.selectedChips.delete(label);
    } else {
      state.selectedChips.add(label);
    }
  }

  /**
   * Enables or disables the Publish button depending on whether a level is chosen.
   */
  function updatePublishState() {
    const btnPublish = document.getElementById("btn-publish");
    if (!btnPublish) return;

    btnPublish.disabled = !state.selectedStatus;
  }

  /**
   * Validates and submits the new report, adds it to the store, and updates the map.
   */
  async function publishReport() {
    if (!state.selectedStatus || !state.targetLatLng || state.isSubmitting) return;

    state.isSubmitting = true;
    const btnPublish = document.getElementById("btn-publish");
    if (btnPublish) btnPublish.disabled = true;

    const areaEl = document.getElementById("report-area");
    const noteInput = document.getElementById("note-input");

    const areaName = areaEl ? areaEl.textContent : "";
    const note = noteInput ? noteInput.value.trim() : "";
    const tags = Array.from(state.selectedChips);

    try {
      const report = await store.addReport({
        lat: state.targetLatLng.lat,
        lng: state.targetLatLng.lng,
        status: state.selectedStatus,
        tags: tags,
        note: note,
        areaName: areaName
      });

      closeReportSheet();
      renderReports();

      // Pan to the newly published pin
      if (state.map) {
        state.map.panTo([report.lat, report.lng], { animate: true, duration: 0.5 });
      }

      showToast("Report published. Thank you for keeping others safe.");
    } catch (err) {
      showToast("Could not publish report: " + err.message);
    } finally {
      state.isSubmitting = false;
      if (btnPublish) btnPublish.disabled = false;
    }
  }

  /* ==========================================================================
     Section: Search (Hyper-Local Gullies, Fuzzy Match & Geocoding)
     ========================================================================== */

  /**
   * Escapes HTML entities to prevent injection in dynamic search lists.
   */
  function escapeHtml(str) {
    if (typeof str !== "string") return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * Curated repository of authentic Mumbai gullies, small streets, chawls,
   * koliwadas, and local food alleys.
   */
  const LOCAL_GULLIES = [
    {
      id: "gully_01",
      name: "Ghatkopar Khau Galli",
      locality: "Ghatkopar East",
      sub: "Famous food street along Vallabh Dongre Road",
      lat: 19.0805,
      lng: 72.9078,
      category: "khau_galli",
      aliases: ["ghatkopar khau gali", "vallabh dongre road", "ghatkopar food gully", "khau galli ghatkopar", "khaw gali"]
    },
    {
      id: "gully_02",
      name: "Princess Street Khau Galli",
      locality: "Marine Lines",
      sub: "Alley behind Mangaldas Market & Dawa Bazaar",
      lat: 18.9448,
      lng: 72.8285,
      category: "khau_galli",
      aliases: ["princess street khau gali", "marine lines food lane", "mangaldas market khau galli", "dawa bazaar gully"]
    },
    {
      id: "gully_03",
      name: "Carter Road Khau Galli & Promenade",
      locality: "Bandra West",
      sub: "Coastal promenade street-food stretch",
      lat: 19.0685,
      lng: 72.8230,
      category: "khau_galli",
      aliases: ["carter road", "carter road gully", "bandra seaside lane", "carter road khau gali"]
    },
    {
      id: "gully_04",
      name: "Mahim Khau Galli",
      locality: "Mahim West",
      sub: "Famous kebab lane near Mahim Dargah",
      lat: 19.0435,
      lng: 72.8415,
      category: "khau_galli",
      aliases: ["mahim dargah lane", "mahim food gully", "mahim khau gali", "dargah gully mahim"]
    },
    {
      id: "gully_05",
      name: "SNDT Churchgate Khau Galli",
      locality: "Churchgate",
      sub: "College food lane on Sir Vithaldas Thackersey Marg",
      lat: 18.9332,
      lng: 72.8296,
      category: "khau_galli",
      aliases: ["churchgate khau gali", "sndt college lane", "cross maidan food gully", "marine lines college street"]
    },
    {
      id: "gully_06",
      name: "Tardeo Khau Galli",
      locality: "Tardeo",
      sub: "Near Sardar Pav Bhaji & AC Market",
      lat: 18.9698,
      lng: 72.8155,
      category: "khau_galli",
      aliases: ["tardeo khau gali", "sardar pav bhaji lane", "tardeo market gully", "ac market tardeo"]
    },
    {
      id: "gully_07",
      name: "Zaveri Bazaar Khau Galli",
      locality: "Kalbadevi",
      sub: "Historic jewelry district snack lane",
      lat: 18.9515,
      lng: 72.8312,
      category: "khau_galli",
      aliases: ["zaveri bazaar", "sheikh memon street", "kalbadevi khau gali", "jewellers lane"]
    },
    {
      id: "gully_08",
      name: "Mahavir Nagar Khau Galli",
      locality: "Kandivali West",
      sub: "Suburban evening street food promenade",
      lat: 19.2130,
      lng: 72.8400,
      category: "khau_galli",
      aliases: ["mahavir nagar", "kandivali khau gali", "mahavir nagar food street", "kandivali west lane"]
    },
    {
      id: "gully_09",
      name: "Bandra Station Khau Galli",
      locality: "Bandra West",
      sub: "Station road market alley",
      lat: 19.0560,
      lng: 72.8405,
      category: "khau_galli",
      aliases: ["bandra station road", "bandra west market gully", "station road food lane", "bandra khau gali"]
    },
    {
      id: "gully_10",
      name: "Mulund MG Road Khau Galli",
      locality: "Mulund West",
      sub: "Evening street cuisine lane off MG Road",
      lat: 19.1730,
      lng: 72.9540,
      category: "khau_galli",
      aliases: ["mulund khau gali", "mulund mg road", "mulund west food street"]
    },
    {
      id: "gully_11",
      name: "Chor Bazaar Mutton Street Gully",
      locality: "Bhendi Bazaar",
      sub: "Antique market alley & historic flea bazaar",
      lat: 18.9602,
      lng: 72.8306,
      category: "gully",
      aliases: ["chor bazaar", "mutton street", "thieves market gully", "chor bazar", "bhendi bazaar lane"]
    },
    {
      id: "gully_12",
      name: "Dadar Phool Galli",
      locality: "Dadar West",
      sub: "Wholesale flower market under Dadar flyover",
      lat: 19.0185,
      lng: 72.8427,
      category: "gully",
      aliases: ["dadar flower market", "phool galli", "phool gali", "senapati bapat marg flower market", "dadar market lane"]
    },
    {
      id: "gully_13",
      name: "Crawford Market Fruits & Spice Alley",
      locality: "Fort / Dhobi Talao",
      sub: "Colonial market lane & wholesale corridors",
      lat: 18.9472,
      lng: 72.8342,
      category: "gully",
      aliases: ["crawford market", "mahatma jyotiba phule mandai", "dhobi talao market gully", "crawford gully"]
    },
    {
      id: "gully_14",
      name: "Colaba Causeway Street Market",
      locality: "Colaba",
      sub: "Boutique flea sidewalk along Shahid Bhagat Singh Road",
      lat: 18.9220,
      lng: 72.8317,
      category: "gully",
      aliases: ["colaba causeway", "shahid bhagat singh road", "colaba market gully", "causeway lane"]
    },
    {
      id: "gully_15",
      name: "Fashion Street Walkway",
      locality: "Azad Maidan / Fort",
      sub: "Pedestrian apparel market opposite Cross Maidan",
      lat: 18.9370,
      lng: 72.8290,
      category: "gully",
      aliases: ["fashion street", "mg road clothes market", "azad maidan walkway", "cross maidan gully"]
    },
    {
      id: "gully_16",
      name: "Kala Ghoda Art District Lane",
      locality: "Fort",
      sub: "Heritage lanes along Forbes Street and Ropewalk Lane",
      lat: 18.9298,
      lng: 72.8327,
      category: "gully",
      aliases: ["kala ghoda", "ropewalk lane", "forbes street", "heritage art district gully"]
    },
    {
      id: "gully_17",
      name: "Bhendi Bazaar Cross Lane",
      locality: "South Mumbai",
      sub: "Commercial lane connecting Mohammad Ali Road",
      lat: 18.9567,
      lng: 72.8330,
      category: "gully",
      aliases: ["bhendi bazaar", "mohammad ali road cross lane", "bhendi bazar lane", "minara masjid gully"]
    },
    {
      id: "gully_18",
      name: "Null Bazaar & Chor Bazaar Lane",
      locality: "Kalbadevi",
      sub: "Historic brassware and hardware lane",
      lat: 18.9545,
      lng: 72.8300,
      category: "gully",
      aliases: ["null bazaar", "nul bazar", "null bazar cross lane", "kalbadevi brass gully"]
    },
    {
      id: "gully_19",
      name: "Mangaldas Market Textile Gully",
      locality: "Kalbadevi",
      sub: "Indoor silk and cloth market lanes",
      lat: 18.9480,
      lng: 72.8320,
      category: "gully",
      aliases: ["mangaldas market", "cloth market gully", "lohar chawl lane", "kalbadevi textile lane"]
    },
    {
      id: "gully_20",
      name: "Lalbaug Market Lane & Raja Gully",
      locality: "Lalbaug / Parel",
      sub: "Traditional spice market lane near Lalbaugcha Raja",
      lat: 18.9912,
      lng: 72.8378,
      category: "gully",
      aliases: ["lalbaug market", "lalbaugcha raja gully", "lalbaug spice market", "dr ambedkar road lane"]
    },
    {
      id: "gully_21",
      name: "Parel Bhoiwada Lane",
      locality: "Parel",
      sub: "Medical hub access lane near KEM Hospital",
      lat: 19.0040,
      lng: 72.8430,
      category: "gully",
      aliases: ["bhoiwada", "kem hospital lane", "parel village gully", "bhoiwada police station road"]
    },
    {
      id: "gully_22",
      name: "Dharavi Kumbharwada Pottery Lane",
      locality: "Dharavi",
      sub: "Potters' colony artisan lanes and kiln gullies",
      lat: 19.0460,
      lng: 72.8580,
      category: "gully",
      aliases: ["kumbharwada", "dharavi potters lane", "dharavi kumbharwada gully", "pottery village"]
    },
    {
      id: "gully_23",
      name: "Dharavi 90 Feet Road Gully",
      locality: "Dharavi",
      sub: "Main commercial spine & leather goods lane",
      lat: 19.0410,
      lng: 72.8550,
      category: "gully",
      aliases: ["dharavi 90 feet road", "dharavi leather market", "90 feet road gully"]
    },
    {
      id: "gully_24",
      name: "Dharavi 60 Feet Road Cross Gully",
      locality: "Dharavi",
      sub: "Connects Mahim to Dharavi transit routes",
      lat: 19.0430,
      lng: 72.8510,
      category: "gully",
      aliases: ["dharavi 60 feet road", "60 feet road lane", "mahim dharavi link gully"]
    },
    {
      id: "gully_25",
      name: "Ranwar Village Heritage Lane",
      locality: "Bandra West",
      sub: "Heritage Anglo-Indian village alleys & street murals",
      lat: 19.0565,
      lng: 72.8312,
      category: "gully",
      aliases: ["ranwar village", "ranwar lane bandra", "waroda road", "bandra graffiti village"]
    },
    {
      id: "gully_26",
      name: "Pali Naka & Pali Village Lane",
      locality: "Bandra West",
      sub: "Vibrant cafe neighborhood and boutique alley",
      lat: 19.0628,
      lng: 72.8288,
      category: "gully",
      aliases: ["pali naka", "pali village", "pali hill gully", "dr ambedkar road bandra west"]
    },
    {
      id: "gully_27",
      name: "Chimbai Koliwada Lane",
      locality: "Bandra West",
      sub: "Seaside fishing village lane off Hill Road",
      lat: 19.0528,
      lng: 72.8228,
      category: "gully",
      aliases: ["chimbai village", "chimbai koliwada", "chimbai road", "bandra fishing lane"]
    },
    {
      id: "gully_28",
      name: "Chuim Village Lane",
      locality: "Khar West",
      sub: "Historic gaothan alleys & quiet residential paths",
      lat: 19.0710,
      lng: 72.8335,
      category: "gully",
      aliases: ["chuim village", "chuim gaothan", "khar west gaothan gully", "chuim lane"]
    },
    {
      id: "gully_29",
      name: "Khar Danda Koliwada Gully",
      locality: "Khar West",
      sub: "Coastal fishing community alleys near Arabian Sea",
      lat: 19.0750,
      lng: 72.8250,
      category: "gully",
      aliases: ["khar danda", "danda koliwada", "khar danda jetty lane", "danda market gully"]
    },
    {
      id: "gully_30",
      name: "Versova Koliwada Jetty Gully",
      locality: "Andheri West",
      sub: "Historic seafood harbor and village corridors",
      lat: 19.1350,
      lng: 72.8120,
      category: "gully",
      aliases: ["versova koliwada", "versova village", "versova jetty gully", "versova fish market lane"]
    },
    {
      id: "gully_31",
      name: "Worli Koliwada Gully & Fort Road",
      locality: "Worli",
      sub: "Seaward village path to British-era Worli Fort",
      lat: 19.0255,
      lng: 72.8160,
      category: "gully",
      aliases: ["worli koliwada", "worli village", "worli fort road", "worli fishing village gully"]
    },
    {
      id: "gully_32",
      name: "Sewri Koliwada Cross Lane",
      locality: "Sewri East",
      sub: "Harbor side community lane near flamingo viewpoint",
      lat: 19.0010,
      lng: 72.8600,
      category: "gully",
      aliases: ["sewri koliwada", "sewri fort lane", "sewri mudflats gully", "sewri east village"]
    },
    {
      id: "gully_33",
      name: "Sion Koliwada Guru Tegh Bahadur Lane",
      locality: "GTB Nagar / Sion",
      sub: "Historic refugee colony & fish market lanes",
      lat: 19.0370,
      lng: 72.8620,
      category: "gully",
      aliases: ["sion koliwada", "gtb nagar", "guru tegh bahadur nagar lane", "sion market gully"]
    },
    {
      id: "gully_34",
      name: "BDD Chawls Worli Gully",
      locality: "Worli",
      sub: "Dense historic community tenement corridors",
      lat: 19.0080,
      lng: 72.8220,
      category: "gully",
      aliases: ["bdd chawl worli", "worli bdd chawls", "ganpatrao kadam marg chawl", "worli chawl lane"]
    },
    {
      id: "gully_35",
      name: "BDD Chawls Naigaon Lane",
      locality: "Dadar East",
      sub: "Central Mumbai historic residential chawl streets",
      lat: 19.0140,
      lng: 72.8480,
      category: "gully",
      aliases: ["bdd chawl naigaon", "naigaon chawls", "dadar east chawl gully", "naigaon cross road"]
    },
    {
      id: "gully_36",
      name: "BDD Chawls NM Joshi Marg",
      locality: "Lower Parel",
      sub: "Tenement lanes opposite Lower Parel railway station",
      lat: 18.9950,
      lng: 72.8290,
      category: "gully",
      aliases: ["bdd chawls nm joshi marg", "lower parel chawls", "delisle road chawl lane", "currey road gully"]
    },
    {
      id: "gully_37",
      name: "Bhatia Chawl & Chira Bazaar Lane",
      locality: "Marine Lines / Kalbadevi",
      sub: "Historic residential chawl corridors in South Mumbai",
      lat: 18.9485,
      lng: 72.8260,
      category: "gully",
      aliases: ["bhatia chawl", "chira bazaar", "chira bazar lane", "princess street chawl", "chira bazaar gully"]
    },
    {
      id: "gully_38",
      name: "Abhyudaya Nagar Chawl Colony",
      locality: "Kalachowki",
      sub: "Worker tenement neighborhood lanes",
      lat: 18.9880,
      lng: 72.8450,
      category: "gully",
      aliases: ["abhyudaya nagar", "kalachowki chawls", "cotton green residential lane", "kalachowki gully"]
    },
    {
      id: "gully_39",
      name: "Matunga Hindu Colony 1st Lane",
      locality: "Matunga East",
      sub: "Leafy residential heritage alley",
      lat: 19.0270,
      lng: 72.8490,
      category: "gully",
      aliases: ["hindu colony matunga", "hindu colony 1st lane", "ruia college lane", "matunga east gully"]
    },
    {
      id: "gully_40",
      name: "Matunga Brahminwada Lane",
      locality: "Matunga Central",
      sub: "Udupi restaurants and traditional market corridor",
      lat: 19.0250,
      lng: 72.8530,
      category: "gully",
      aliases: ["brahminwada matunga", "matunga circle lane", "kings circle gully", "matunga south indian street"]
    },
    {
      id: "gully_41",
      name: "Wadala Antop Hill CGS Colony Lane",
      locality: "Wadala East",
      sub: "Central government staff residential lanes",
      lat: 19.0230,
      lng: 72.8680,
      category: "gully",
      aliases: ["antop hill", "antop hill gully", "cgs colony wadala", "wadala east lane", "sangam nagar"]
    },
    {
      id: "gully_42",
      name: "Kurla Pipe Road Gully",
      locality: "Kurla West",
      sub: "Transit and market shortcut off LBS Marg",
      lat: 19.0665,
      lng: 72.8795,
      category: "gully",
      aliases: ["pipe road kurla", "kurla pipe road gully", "kurla west market lane", "pipe road"]
    },
    {
      id: "gully_43",
      name: "Kurla Bail Bazaar Lane",
      locality: "Kurla West",
      sub: "Busy commercial junction and auto repair gully",
      lat: 19.0760,
      lng: 72.8850,
      category: "gully",
      aliases: ["bail bazaar", "bail bazar kurla", "kurla bail bazaar gully", "kamani junction lane"]
    },
    {
      id: "gully_44",
      name: "Chembur Camp Sindhi Society Lane",
      locality: "Chembur",
      sub: "Famous food hub and sweet shop alley",
      lat: 19.0550,
      lng: 72.8980,
      category: "gully",
      aliases: ["chembur camp", "sindhi society chembur", "chembur food gully", "collector colony lane"]
    },
    {
      id: "gully_45",
      name: "Ghatkopar Pant Nagar Gully",
      locality: "Ghatkopar East",
      sub: "Residential gaothan and commercial corridors",
      lat: 19.0820,
      lng: 72.9140,
      category: "gully",
      aliases: ["pant nagar", "pant nagar ghatkopar", "pant nagar 90 feet road", "ghatkopar east gully"]
    },
    {
      id: "gully_46",
      name: "Vikhroli Tagore Nagar Lane",
      locality: "Vikhroli East",
      sub: "Transit lane toward Eastern Express Highway",
      lat: 19.1060,
      lng: 72.9300,
      category: "gully",
      aliases: ["tagore nagar vikhroli", "tagore nagar lane", "vikhroli east gully", "kannawar nagar"]
    },
    {
      id: "gully_47",
      name: "Bhandup Sonapur Gully",
      locality: "Bhandup West",
      sub: "LBS Marg connecting bazaar lane",
      lat: 19.1450,
      lng: 72.9370,
      category: "gully",
      aliases: ["sonapur bhandup", "bhandup sonapur lane", "lbs marg bhandup gully", "sonapur junction"]
    },
    {
      id: "gully_48",
      name: "Mulund Paanch Raasta Lane",
      locality: "Mulund West",
      sub: "Five-way junction market streets and residential lanes",
      lat: 19.1725,
      lng: 72.9560,
      category: "gully",
      aliases: ["paanch raasta", "panch rasta mulund", "mulund west paanch rasta", "mg road mulund gully"]
    },
    {
      id: "gully_49",
      name: "Thane Gokhale Road & Jambli Naka Gully",
      locality: "Thane West",
      sub: "Thane's oldest commercial market and street food street",
      lat: 19.1910,
      lng: 72.9750,
      category: "gully",
      aliases: ["jambli naka thane", "gokhale road thane", "thane market gully", "chendani koliwada"]
    },
    {
      id: "gully_50",
      name: "Thane Talao Pali Promenade Lane",
      locality: "Thane West",
      sub: "Historic lake walkway and street snack stalls",
      lat: 19.1920,
      lng: 72.9720,
      category: "gully",
      aliases: ["talao pali thane", "masunda lake lane", "thane lake promenade gully"]
    },
    {
      id: "gully_51",
      name: "Vashi Sector 9 Market Gully",
      locality: "Navi Mumbai",
      sub: "Vashi central market street and shopping alleys",
      lat: 19.0750,
      lng: 72.9980,
      category: "gully",
      aliases: ["vashi sector 9", "vashi market gully", "navi mumbai vashi lane", "sector 9 market"]
    },
    {
      id: "gully_52",
      name: "Nerul Sector 15 Palm Beach Lane",
      locality: "Navi Mumbai",
      sub: "Residential avenue cross street near seawoods",
      lat: 19.0330,
      lng: 73.0180,
      category: "gully",
      aliases: ["nerul sector 15", "palm beach road cross lane", "nerul west gully", "seawoods lane"]
    },
    {
      id: "gully_53",
      name: "Bandra Hill Road Market Gully",
      locality: "Bandra West",
      sub: "Shopping street stalls from St. Peter's to Bandra station",
      lat: 19.0550,
      lng: 72.8320,
      category: "gully",
      aliases: ["hill road bandra", "elco market gully", "bandra shopping street", "hill road lane"]
    },
    {
      id: "gully_54",
      name: "Bandra Linking Road Footwear Gully",
      locality: "Bandra West",
      sub: "Popular retail stalls off Waterfield Road",
      lat: 19.0645,
      lng: 72.8335,
      category: "gully",
      aliases: ["linking road", "linking road bandra", "linking road market gully", "waterfield road cross lane"]
    },
    {
      id: "gully_55",
      name: "Santacruz Station Skywalk & Station Road Gully",
      locality: "Santacruz West",
      sub: "Dense market street and skywalk descent",
      lat: 19.0830,
      lng: 72.8400,
      category: "gully",
      aliases: ["santacruz station road", "santacruz skywalk gully", "santacruz west market lane", "hasnabad lane"]
    },
    {
      id: "gully_56",
      name: "Vile Parle Subhash Road Lane",
      locality: "Vile Parle East",
      sub: "Station market and traditional Maharashtrian snack lane",
      lat: 19.0980,
      lng: 72.8480,
      category: "gully",
      aliases: ["subhash road vile parle", "vile parle east market gully", "vile parle station road"]
    },
    {
      id: "gully_57",
      name: "Irla Market Lane near Mithibai College",
      locality: "Vile Parle West",
      sub: "Shopping lane and college food stalls off SV Road",
      lat: 19.1060,
      lng: 72.8380,
      category: "gully",
      aliases: ["irla market", "irla lane", "mithibai college gully", "cooper hospital road", "mitibai"]
    },
    {
      id: "gully_58",
      name: "Mithibai College Canteen Lane",
      locality: "Vile Parle West",
      sub: "Popular student food and evening meeting corridor",
      lat: 19.1056,
      lng: 72.8372,
      category: "gully",
      aliases: ["mithibai college", "mithibai lane", "nm college road", "vile parle west college gully"]
    },
    {
      id: "gully_59",
      name: "Andheri West SV Road & Fish Market Gully",
      locality: "Andheri West",
      sub: "Dense station approach market street",
      lat: 19.1200,
      lng: 72.8450,
      category: "gully",
      aliases: ["andheri west market", "andheri sv road gully", "andheri station road west", "fish market andheri"]
    },
    {
      id: "gully_60",
      name: "Andheri Lokhandwala Market Backroad Gully",
      locality: "Andheri West",
      sub: "Famous fashion and cafe backstreet in Lokhandwala Complex",
      lat: 19.1420,
      lng: 72.8270,
      category: "gully",
      aliases: ["lokhandwala backroad", "lokhandwala market", "lokhandwala gully", "andheri lokhandwala"]
    },
    {
      id: "gully_61",
      name: "Andheri DN Nagar Metro Subway & Gully",
      locality: "Andheri West",
      sub: "Metro line junction and residential gaothan path",
      lat: 19.1250,
      lng: 72.8320,
      category: "gully",
      aliases: ["dn nagar metro", "dn nagar gully", "andheri dn nagar lane", "barfiwala college road"]
    },
    {
      id: "gully_62",
      name: "Veera Desai Industrial Road Gully",
      locality: "Andheri West",
      sub: "Commercial studios and transit road behind Azad Nagar Metro",
      lat: 19.1290,
      lng: 72.8370,
      category: "gully",
      aliases: ["veera desai road", "veera desai", "azad nagar metro lane", "andheri west studio gully"]
    },
    {
      id: "gully_63",
      name: "Andheri Chakala Cigarette Factory Gully",
      locality: "Andheri East",
      sub: "Industrial connector between Chakala Metro and Sahar Road",
      lat: 19.1140,
      lng: 72.8650,
      category: "gully",
      aliases: ["chakala gully", "andheri east cigarette factory lane", "chakala metro lane", "sahar road gully"]
    },
    {
      id: "gully_64",
      name: "Andheri MIDC Central Road Cross Gully",
      locality: "Andheri East",
      sub: "Commercial IT corridor and office commute lane",
      lat: 19.1220,
      lng: 72.8720,
      category: "gully",
      aliases: ["andheri midc", "midc central road", "marol midc gully", "andheri east it lane"]
    },
    {
      id: "gully_65",
      name: "Jogeshwari Caves Road & Behram Baug Gully",
      locality: "Jogeshwari West",
      sub: "Station approach and residential market corridor",
      lat: 19.1380,
      lng: 72.8490,
      category: "gully",
      aliases: ["jogeshwari caves road", "behram baug", "jogeshwari west market lane", "jogeshwari gully"]
    },
    {
      id: "gully_66",
      name: "Goregaon Topiwala Market Lane",
      locality: "Goregaon West",
      sub: "Vibrant community vegetable and clothing market",
      lat: 19.1640,
      lng: 72.8480,
      category: "gully",
      aliases: ["topiwala market", "goregaon west market", "topiwala lane", "station road goregaon"]
    },
    {
      id: "gully_67",
      name: "Goregaon Aarey Milk Colony Picnic Point Lane",
      locality: "Goregaon East",
      sub: "Scenic forested road connecting Western Express to Powai",
      lat: 19.1520,
      lng: 72.8750,
      category: "gully",
      aliases: ["aarey colony", "aarey milk colony", "picnic point aarey", "goregaon east forest road"]
    },
    {
      id: "gully_68",
      name: "Malad Marve Road & Mithchowki Gully",
      locality: "Malad West",
      sub: "Heavy transit artery connecting Inorbit to Marve Beach",
      lat: 19.1870,
      lng: 72.8380,
      category: "gully",
      aliases: ["marve road malad", "mithchowki", "malad west link road", "marve beach road gully"]
    },
    {
      id: "gully_69",
      name: "Malad Liberty Garden Lane",
      locality: "Malad West",
      sub: "Quiet residential neighborhood avenue off SV Road",
      lat: 19.1840,
      lng: 72.8490,
      category: "gully",
      aliases: ["liberty garden", "malad liberty garden lane", "sv road malad west gully"]
    },
    {
      id: "gully_70",
      name: "Kandivali Poisar Subway & Chawl Gully",
      locality: "Kandivali West",
      sub: "Pedestrian subway connection under railway tracks",
      lat: 19.2060,
      lng: 72.8520,
      category: "gully",
      aliases: ["poisar subway", "kandivali subway gully", "poisar chawl lane", "kandivali station subway"]
    },
    {
      id: "gully_71",
      name: "Borivali IC Colony Cross Lane",
      locality: "Borivali West",
      sub: "Peaceful residential neighborhood lanes & bakeries",
      lat: 19.2460,
      lng: 72.8510,
      category: "gully",
      aliases: ["ic colony", "borivali ic colony", "holy cross church lane", "ic colony gully"]
    },
    {
      id: "gully_72",
      name: "Borivali Station Service Lane & Babhai Naka",
      locality: "Borivali West",
      sub: "Station service lane behind parking and shops",
      lat: 19.2310,
      lng: 72.8560,
      category: "gully",
      aliases: ["borivali service lane", "babhai naka", "borivali west station road", "borivali service gully"]
    },
    {
      id: "gully_73",
      name: "Dahisar Anand Nagar Gully",
      locality: "Dahisar East",
      sub: "Toll naka approach and residential market street",
      lat: 19.2590,
      lng: 72.8650,
      category: "gully",
      aliases: ["anand nagar dahisar", "dahisar check naka lane", "dahisar east market gully"]
    },
    {
      id: "gully_74",
      name: "Mira Road Shanti Nagar Sector 4 Gully",
      locality: "Mira Road",
      sub: "High-density residential and shopping promenade",
      lat: 19.2830,
      lng: 72.8680,
      category: "gully",
      aliases: ["shanti nagar mira road", "mira road sector 4", "mira road market lane"]
    },
    {
      id: "gully_75",
      name: "Bhayandar West Station Cross Lane",
      locality: "Bhayandar West",
      sub: "Busy commercial station approach and temple road",
      lat: 19.3010,
      lng: 72.8520,
      category: "gully",
      aliases: ["bhayandar station road", "bhayandar west market gully", "maxus mall road"]
    }
  ];

  /**
   * Calculates Levenshtein distance between two strings.
   */
  function levenshteinDistance(s1, s2) {
    const a = s1 || "";
    const b = s2 || "";
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }

  /**
   * Normalizes colloquial spelling variations in Indian/Mumbai locality queries.
   */
  function normalizeSearchWord(word) {
    const map = {
      gali: "gully",
      gallis: "gully",
      galii: "gully",
      gulley: "gully",
      lane: "gully",
      khaw: "khau",
      khao: "khau",
      chawal: "chawl",
      chawle: "chawl",
      bazar: "bazaar",
      bazzar: "bazaar",
      rd: "road",
      stn: "station",
      st: "street",
      marg: "road",
      raod: "road",
      bandar: "bandra",
      bndra: "bandra",
      andher: "andheri",
      borivli: "borivali",
      kurlaa: "kurla",
      mitibai: "mithibai"
    };
    return map[word] || word;
  }

  const GENERIC_GULLY_WORDS = new Set(["gully", "lane", "street", "road", "mumbai", "cross"]);

  /**
   * Computes flexible fuzzy matching score (0 to 100) between query and target.
   */
  function computeFuzzyScore(rawQuery, targetText, aliasList = []) {
    const cleanQ = (rawQuery || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    const cleanT = (targetText || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

    if (!cleanQ || !cleanT) return 0;

    // Direct match
    if (cleanT === cleanQ) return 100;
    if (cleanT.startsWith(cleanQ)) return 95;
    if (cleanT.includes(cleanQ)) return 85;

    // Check alias list for match
    for (const alias of aliasList) {
      const cleanAlias = (alias || "").toLowerCase().replace(/[^\w\s]/g, " ").trim();
      if (cleanAlias === cleanQ) return 98;
      if (cleanAlias.includes(cleanQ)) return 88;
    }

    const qWords = cleanQ.split(" ").filter(w => w.length > 0).map(normalizeSearchWord);
    const tWords = cleanT.split(" ").filter(w => w.length > 0).map(normalizeSearchWord);

    if (qWords.length === 0 || tWords.length === 0) return 0;

    let matchedWordScore = 0;
    let distinguishingMatch = false;

    for (const qw of qWords) {
      let wordFound = false;
      const isGeneric = GENERIC_GULLY_WORDS.has(qw);

      for (const tw of tWords) {
        if (qw === tw) {
          matchedWordScore += 1.0;
          wordFound = true;
          if (!isGeneric) distinguishingMatch = true;
          break;
        }
        if (tw.startsWith(qw) && qw.length >= 3) {
          matchedWordScore += 0.85;
          wordFound = true;
          if (!isGeneric) distinguishingMatch = true;
          break;
        }
        if (qw.startsWith(tw) && tw.length >= 3) {
          matchedWordScore += 0.8;
          wordFound = true;
          if (!isGeneric) distinguishingMatch = true;
          break;
        }
        // Levenshtein typo check for words of length >= 4
        if (qw.length >= 4 && tw.length >= 4) {
          const dist = levenshteinDistance(qw, tw);
          if (dist <= 1) {
            matchedWordScore += 0.8;
            wordFound = true;
            if (!isGeneric) distinguishingMatch = true;
            break;
          } else if (dist <= 2 && (qw.length >= 6 || tw.length >= 6)) {
            matchedWordScore += 0.55;
            wordFound = true;
            if (!isGeneric) distinguishingMatch = true;
            break;
          }
        }
      }

      if (!wordFound && aliasList.length > 0) {
        for (const alias of aliasList) {
          const normAlias = normalizeSearchWord(alias.toLowerCase());
          const aliasWords = normAlias.split(" ");
          if (aliasWords.includes(qw)) {
            matchedWordScore += 0.85;
            if (!isGeneric) distinguishingMatch = true;
            break;
          } else if (aliasWords.some(aw => aw.startsWith(qw) && qw.length >= 3)) {
            matchedWordScore += 0.7;
            if (!isGeneric) distinguishingMatch = true;
            break;
          }
        }
      }
    }

    const hasNonGenericQ = qWords.some(w => !GENERIC_GULLY_WORDS.has(w));
    if (hasNonGenericQ && !distinguishingMatch) {
      return 0;
    }

    const ratio = matchedWordScore / qWords.length;
    return ratio * 85;
  }

  /**
   * Matches query against curated local gullies and all user-submitted safety reports.
   */
  function matchLocalLocations(query) {
    const results = [];

    // 1. Match curated local gullies
    LOCAL_GULLIES.forEach(item => {
      const fullText = `${item.name} ${item.locality} ${item.sub} ${(item.aliases || []).join(" ")}`;
      const score = computeFuzzyScore(query, fullText, item.aliases || []);
      if (score >= 40) {
        results.push({
          id: item.id,
          primaryName: item.name,
          subName: `${item.locality} · ${item.sub || "Local Gully"}`,
          lat: item.lat,
          lng: item.lng,
          category: "gully",
          badgeText: item.category === "khau_galli" ? "Khau Galli" : "Local Gully",
          score: score
        });
      }
    });

    // 2. Match active safety reports in store
    try {
      const reports = (typeof store !== "undefined" && store.getAllReports) ? store.getAllReports() : [];
      reports.forEach(report => {
        const fullText = `${report.areaName} ${report.note || ""} ${(report.tags || []).join(" ")}`;
        const score = computeFuzzyScore(query, fullText, report.tags || []);
        if (score >= 40) {
          const statusLabel = report.status ? report.status.toUpperCase() : "REPORT";
          const confText = `${report.confirmations || 1} confirmed`;
          const sub = `${statusLabel} · ${confText} ${report.note ? "· " + report.note : ""}`;
          results.push({
            id: "report_" + report.id,
            primaryName: report.areaName || "Street Report",
            subName: sub,
            lat: report.lat,
            lng: report.lng,
            category: "report",
            status: report.status || "safe",
            reportId: report.id,
            badgeText: `${statusLabel} Pin`,
            score: score + 5
          });
        }
      });
    } catch {
      // Continue without store reports
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  /**
   * Merges local fuzzy matches with remote Nominatim results, preventing spatial duplicates.
   */
  function mergeAndDeduplicateResults(localMatches, remoteMatches) {
    const combined = [...localMatches];

    remoteMatches.forEach(remote => {
      const isDuplicate = combined.some(existing => {
        const dLat = Math.abs(existing.lat - remote.lat);
        const dLng = Math.abs(existing.lng - remote.lng);
        return dLat < 0.003 && dLng < 0.003;
      });

      if (!isDuplicate) {
        combined.push(remote);
      }
    });

    return combined;
  }

  /**
   * Runs enhanced place search with Mumbai geographic bias, local gully matching,
   * fuzzy tolerance, and live fallback handling.
   * @param {string} rawQuery - Location search query.
   * @param {boolean} [isLiveInput=false] - Whether triggered from typing debounce.
   */
  async function runSearch(rawQuery, isLiveInput = false) {
    const searchResults = document.getElementById("search-results");
    if (!searchResults) return;

    const query = (rawQuery || "").trim();
    if (query.length < 2) {
      searchResults.innerHTML = "";
      searchResults.classList.add("hidden");
      return;
    }

    // 1. Perform instant local fuzzy matching
    const localMatches = matchLocalLocations(query);

    // Show local results immediately while remote search resolves
    if (localMatches.length > 0) {
      renderSearchResults(localMatches, query, true);
    } else {
      searchResults.innerHTML = `
        <div class="search-status">
          <i data-lucide="loader-circle" class="spin"></i>
          <span>Searching local gullies & landmarks...</span>
        </div>
      `;
      searchResults.classList.remove("hidden");
      refreshIcons();
    }

    // Abort previous in-flight request if any
    if (state.searchAbortController) {
      state.searchAbortController.abort();
    }
    state.searchAbortController = new AbortController();

    try {
      // Append local geographic bias or context if query is short or lacks locality
      let geocodeQuery = query;
      const lowerQ = query.toLowerCase();
      const hasMumbaiContext = lowerQ.includes("mumbai") || lowerQ.includes("bombay") || lowerQ.includes("thane") || lowerQ.includes("navi mumbai");
      if (!hasMumbaiContext) {
        geocodeQuery = `${query}, Mumbai, Maharashtra, India`;
      }

      // Nominatim search biased to Mumbai viewBox (72.70, 19.38, 73.18, 18.80)
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&countrycodes=in&viewbox=72.70,19.38,73.18,18.80&bounded=0&q=${encodeURIComponent(geocodeQuery)}`;
      const res = await fetch(url, {
        signal: state.searchAbortController.signal,
        headers: { "Accept-Language": "en" }
      });

      if (!res.ok) throw new Error("Search network error");
      const remoteItems = await res.json();

      const remoteMatches = (Array.isArray(remoteItems) ? remoteItems : []).map(item => {
        const parts = (item.display_name || "").split(",").map(p => p.trim());
        const primary = parts.slice(0, 2).join(", ");
        const sub = parts.slice(2).join(", ");
        return {
          id: "osm_" + (item.place_id || Math.random().toString(36).slice(2)),
          primaryName: primary || item.name || query,
          subName: sub || "Mumbai, Maharashtra",
          lat: parseFloat(item.lat),
          lng: parseFloat(item.lon),
          category: "place",
          badgeText: "Geocoded Place",
          score: 50
        };
      });

      const merged = mergeAndDeduplicateResults(localMatches, remoteMatches);
      renderSearchResults(merged, query, false);
    } catch (err) {
      if (err.name === "AbortError") return;
      if (localMatches.length > 0) {
        renderSearchResults(localMatches, query, false);
      } else {
        renderSearchResults([], query, false);
        if (!isLiveInput) {
          showToast("Network search timed out. Showing local matches only.");
        }
      }
    }
  }

  /**
   * Renders location results or displays the required local gully empty state.
   * @param {Array<Object>} items - Search results.
   * @param {string} query - The search query.
   * @param {boolean} [isLoadingMore=false] - Whether geocoding is still resolving.
   */
  function renderSearchResults(items, query, isLoadingMore = false) {
    const searchResults = document.getElementById("search-results");
    if (!searchResults) return;

    searchResults.innerHTML = "";

    if (!Array.isArray(items) || items.length === 0) {
      searchResults.innerHTML = `
        <div class="search-status search-empty">
          <div class="search-empty-icon" aria-hidden="true">
            <i data-lucide="map-pin-off"></i>
          </div>
          <div class="search-empty-text">
            <strong class="search-empty-title">No local gullies found. Try zooming or searching nearby landmarks</strong>
            <span class="search-empty-sub">Try searching by major station, college, chowk, or road name.</span>
          </div>
        </div>
      `;
      searchResults.classList.remove("hidden");
      refreshIcons();
      return;
    }

    const displayList = items.slice(0, 6);

    displayList.forEach(item => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `search-item search-item-${item.category || "place"}`;

      let iconName = "map-pin";
      let iconClass = "icon-place";
      let badgeClass = "badge-place";

      if (item.category === "gully") {
        iconName = "map-pin";
        iconClass = "icon-gully";
        badgeClass = "badge-gully";
      } else if (item.category === "report") {
        if (item.status === "unsafe") {
          iconName = "shield-alert";
          iconClass = "icon-unsafe";
          badgeClass = "badge-report-unsafe";
        } else if (item.status === "caution") {
          iconName = "triangle-alert";
          iconClass = "icon-caution";
          badgeClass = "badge-report-caution";
        } else {
          iconName = "shield-check";
          iconClass = "icon-safe";
          badgeClass = "badge-report-safe";
        }
      }

      row.innerHTML = `
        <div class="search-item-left">
          <div class="search-item-icon ${iconClass}" aria-hidden="true">
            <i data-lucide="${iconName}"></i>
          </div>
          <div class="search-item-info">
            <span class="search-item-primary">${escapeHtml(item.primaryName)}</span>
            <span class="search-item-sub">${escapeHtml(item.subName)}</span>
          </div>
        </div>
        <span class="search-item-badge ${badgeClass}">${escapeHtml(item.badgeText || "Location")}</span>
      `;

      row.addEventListener("click", () => {
        flyToResult(item);
      });

      searchResults.appendChild(row);
    });

    if (isLoadingMore) {
      const loadingRow = document.createElement("div");
      loadingRow.className = "search-status";
      loadingRow.innerHTML = `
        <i data-lucide="loader-circle" class="spin"></i>
        <span>Checking geocoding satellites...</span>
      `;
      searchResults.appendChild(loadingRow);
    }

    searchResults.classList.remove("hidden");
    refreshIcons();
  }

  /**
   * Flies map to chosen search result, shows temporary pulsing ring,
   * and opens inspection card if it is a community report.
   * @param {Object} item - Chosen search item.
   */
  function flyToResult(item) {
    const lat = parseFloat(item.lat);
    const lon = parseFloat(item.lon !== undefined ? item.lon : item.lng);
    if (isNaN(lat) || isNaN(lon) || !state.map) return;

    const searchResults = document.getElementById("search-results");
    if (searchResults) searchResults.classList.add("hidden");

    const searchInput = document.getElementById("search-input");
    if (searchInput) searchInput.blur();

    const targetZoom = item.category === "gully" ? 17 : 16;
    state.map.flyTo([lat, lon], targetZoom, { duration: 1.5 });

    // If report item, open inspection card
    if (item.category === "report" && item.reportId) {
      setTimeout(() => {
        openInspect(item.reportId);
      }, 700);
      return;
    }

    // Show temporary amber/emerald locator ring marker for 6 seconds
    if (state.searchRingMarker) {
      state.map.removeLayer(state.searchRingMarker);
    }

    const ringHtml = `
      <div class="search-ring-container">
        <div class="search-ring"></div>
      </div>
    `;

    const ringIcon = L.divIcon({
      className: "search-ring-icon",
      html: ringHtml,
      iconSize: [64, 64],
      iconAnchor: [32, 32]
    });

    state.searchRingMarker = L.marker([lat, lon], { icon: ringIcon, interactive: false }).addTo(state.map);

    setTimeout(() => {
      if (state.searchRingMarker && state.map) {
        state.map.removeLayer(state.searchRingMarker);
        state.searchRingMarker = null;
      }
    }, 6000);

    showToast(`Navigated to ${item.primaryName}`);
  }

  /* ==========================================================================
     Section: Location (GPS Tracking)
     ========================================================================== */

  /**
   * Requests user location or centers map on cached GPS position.
   */
  function locateMe() {
    if (!navigator.geolocation) {
      showToast("Geolocation is not supported by your browser.");
      return;
    }

    if (state.lastKnownPosition && state.map) {
      state.map.flyTo(state.lastKnownPosition, 17);
      return;
    }

    showToast("Finding your location...");
    startWatch();
  }

  /**
   * Starts high-accuracy GPS watchPosition stream.
   */
  function startWatch() {
    if (!navigator.geolocation) return;

    if (state.watchId !== null) {
      navigator.geolocation.clearWatch(state.watchId);
    }

    state.watchId = navigator.geolocation.watchPosition(
      (pos) => onPosition(pos),
      (err) => onPositionError(err),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }

  /**
   * Handles successful position updates from Geolocation API.
   * @param {GeolocationPosition} pos - GPS position.
   */
  function onPosition(pos) {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const accuracy = Math.min(pos.coords.accuracy || 30, 150);

    const latlng = [lat, lng];
    const isFirstFix = !state.lastKnownPosition;
    state.lastKnownPosition = latlng;

    if (!state.map) return;

    // Update or create pulsing user location dot
    if (!state.userLocationMarker) {
      const dotHtml = `
        <div class="user-dot-container">
          <div class="user-dot-pulse"></div>
          <div class="user-dot-core"></div>
        </div>
      `;
      const dotIcon = L.divIcon({
        className: "user-dot-icon",
        html: dotHtml,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });
      state.userLocationMarker = L.marker(latlng, { icon: dotIcon, interactive: false, zIndexOffset: 1000 }).addTo(state.map);
    } else {
      state.userLocationMarker.setLatLng(latlng);
    }

    // Update or create accuracy circle
    if (!state.userAccuracyCircle) {
      state.userAccuracyCircle = L.circle(latlng, {
        radius: accuracy,
        color: "#3B82F6",
        weight: 1,
        fillColor: "#3B82F6",
        fillOpacity: 0.1,
        interactive: false
      }).addTo(state.map);
    } else {
      state.userAccuracyCircle.setLatLng(latlng);
      state.userAccuracyCircle.setRadius(accuracy);
    }

    if (isFirstFix) {
      state.map.flyTo(latlng, 17);
    }
  }

  /**
   * Handles errors from Geolocation API.
   * @param {GeolocationPositionError} err - Error object.
   */
  function onPositionError(err) {
    if (err.code === 1) { // PERMISSION_DENIED
      showToast("Location is blocked. Allow location in your browser settings to use this.");
    } else {
      showToast("Could not get your location. Move to an open area and try again.");
    }
  }

  /* ==========================================================================
     Section: WhatsApp SOS
     ========================================================================== */

  /**
   * Builds the formatted WhatsApp emergency text and URL.
   * @param {number|null} lat - Latitude.
   * @param {number|null} lng - Longitude.
   * @returns {string} WhatsApp URL.
   */
  function buildSosUrl(lat, lng) {
    let msg = "";
    if (typeof lat === "number" && typeof lng === "number") {
      const mapsLink = `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
      msg = `EMERGENCY: I do not feel safe. Please call me or come to my location now. My live location: ${mapsLink} (sent from Jugnu)`;
    } else {
      msg = "EMERGENCY: I do not feel safe. Please call me now. (sent from Jugnu, location unavailable)";
    }
    return `https://wa.me/?text=${encodeURIComponent(msg)}`;
  }

  /**
   * Triggers one-tap emergency WhatsApp message.
   */
  function sendSos() {
    // If cached position is available, open synchronously to prevent popup blockers
    if (state.lastKnownPosition) {
      const url = buildSosUrl(state.lastKnownPosition[0], state.lastKnownPosition[1]);
      window.open(url, "_blank");
      return;
    }

    // Otherwise try quick getCurrentPosition with 8s timeout
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const url = buildSosUrl(pos.coords.latitude, pos.coords.longitude);
          window.location.href = url;
        },
        () => {
          const url = buildSosUrl(null, null);
          window.location.href = url;
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      const url = buildSosUrl(null, null);
      window.location.href = url;
    }
  }

  /* ==========================================================================
     Section: Fake Incoming Call ("Exit Call")
     ========================================================================== */

  /**
   * Initiates the fake incoming exit call with a 3-second delay.
   */
  function startFakeCall() {
    if (state.isCallPending) return;
    state.isCallPending = true;

    // Initialize or resume Web Audio AudioContext immediately on user gesture
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        if (!state.audioCtx) {
          state.audioCtx = new AudioContextClass();
        }
        if (state.audioCtx.state === "suspended") {
          state.audioCtx.resume();
        }
      }
    } catch {
      // AudioContext fallback handled silently
    }

    showToast("Call arriving in 3 seconds");

    setTimeout(() => {
      state.isCallPending = false;
      showCallScreen();
    }, 3000);
  }

  /**
   * Displays the full-screen incoming call UI and starts ringing.
   */
  function showCallScreen() {
    const callScreen = document.getElementById("call-screen");
    const callStatus = document.getElementById("call-status");
    const incomingActions = document.querySelector(".incoming-actions");
    const activeActions = document.querySelector(".active-actions");

    if (!callScreen) return;

    if (callStatus) callStatus.textContent = "Calling...";
    if (incomingActions) incomingActions.classList.remove("hidden");
    if (activeActions) activeActions.classList.add("hidden");

    callScreen.classList.remove("hidden");
    startRinging();
  }

  /**
   * Plays the phone ringtone using Web Audio dual oscillators (440Hz + 480Hz) and triggers vibration.
   */
  function startRinging() {
    // Hardware vibration where supported
    if ("vibrate" in navigator) {
      try {
        navigator.vibrate([800, 400, 800]);
      } catch {
        // Ignore vibration error
      }
    }

    // Audio generation
    if (!state.audioCtx) return;

    function playBeep() {
      if (!state.audioCtx || state.audioCtx.state === "closed") return;
      try {
        const osc1 = state.audioCtx.createOscillator();
        const osc2 = state.audioCtx.createOscillator();
        const gain = state.audioCtx.createGain();

        osc1.type = "sine";
        osc2.type = "sine";
        osc1.frequency.setValueAtTime(440, state.audioCtx.currentTime);
        osc2.frequency.setValueAtTime(480, state.audioCtx.currentTime);

        gain.gain.setValueAtTime(0.15, state.audioCtx.currentTime);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(state.audioCtx.destination);

        osc1.start();
        osc2.start();

        // 1.5 seconds on
        osc1.stop(state.audioCtx.currentTime + 1.5);
        osc2.stop(state.audioCtx.currentTime + 1.5);
      } catch {
        // Ignore Web Audio errors
      }
    }

    playBeep();
    // 1.5s on / 2s off cycle => repeats every 3.5s
    state.ringtoneInterval = setInterval(() => {
      playBeep();
      if ("vibrate" in navigator) {
        try {
          navigator.vibrate([800, 400, 800]);
        } catch {
          // Ignore
        }
      }
    }, 3500);
  }

  /**
   * Stops the ringtone oscillators, clears interval, and stops vibration.
   */
  function stopRinging() {
    if (state.ringtoneInterval) {
      clearInterval(state.ringtoneInterval);
      state.ringtoneInterval = null;
    }
    if ("vibrate" in navigator) {
      try {
        navigator.vibrate(0);
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Answers the fake call, stops ringtone, and starts live mm:ss timer.
   */
  function answerCall() {
    stopRinging();

    const incomingActions = document.querySelector(".incoming-actions");
    const activeActions = document.querySelector(".active-actions");
    const callStatus = document.getElementById("call-status");

    if (incomingActions) incomingActions.classList.add("hidden");
    if (activeActions) activeActions.classList.remove("hidden");

    state.callSeconds = 0;
    if (callStatus) callStatus.textContent = "00:00";

    if (state.callTimerInterval) {
      clearInterval(state.callTimerInterval);
    }

    state.callTimerInterval = setInterval(() => {
      state.callSeconds += 1;
      if (callStatus) {
        callStatus.textContent = formatTimer(state.callSeconds);
      }
    }, 1000);
  }

  /**
   * Ends or declines the call and returns user to the map exactly as it was.
   */
  function endCall() {
    stopRinging();

    if (state.callTimerInterval) {
      clearInterval(state.callTimerInterval);
      state.callTimerInterval = null;
    }
    state.callSeconds = 0;

    const callScreen = document.getElementById("call-screen");
    if (callScreen) {
      callScreen.classList.add("hidden");
    }
  }

  /**
   * Formats elapsed call seconds as mm:ss string.
   * @param {number} totalSeconds - Elapsed seconds.
   * @returns {string} Formatted "mm:ss".
   */
  function formatTimer(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    const padMins = mins < 10 ? "0" + mins : mins;
    const padSecs = secs < 10 ? "0" + secs : secs;
    return `${padMins}:${padSecs}`;
  }

  /* ==========================================================================
     Section: Helpers
     ========================================================================== */

  let toastTimer = null;

  /**
   * Displays a floating toast message below the safe area.
   * @param {string} msg - Notification message text.
   */
  function showToast(msg) {
    const toast = document.getElementById("toast");
    if (!toast) return;

    toast.textContent = msg;
    toast.classList.remove("hidden");
    toast.style.opacity = "1";

    if (toastTimer) clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => {
        toast.classList.add("hidden");
      }, 150);
    }, 3500);
  }

  /**
   * Opens a bottom sheet or modal dialog with scrim.
   * @param {HTMLElement} el - Sheet element to open.
   */
  function openSheet(el) {
    if (!el) return;

    // Close any other open sheet first
    const sheets = document.querySelectorAll(".sheet");
    sheets.forEach(s => {
      if (s !== el) {
        s.classList.remove("is-open");
        s.classList.add("hidden");
      }
    });

    el.classList.remove("hidden");
    // Trigger reflow for slide animation
    void el.offsetWidth;
    el.classList.add("is-open");

    const scrim = document.getElementById("scrim");
    if (scrim) {
      scrim.classList.remove("hidden");
    }
  }

  /**
   * Closes a bottom sheet and hides scrim.
   * @param {HTMLElement} el - Sheet element to close.
   */
  function closeSheet(el) {
    if (!el) return;
    el.classList.remove("is-open");
    setTimeout(() => {
      el.classList.add("hidden");
      const openRemaining = document.querySelectorAll(".sheet.is-open");
      if (openRemaining.length === 0) {
        const scrim = document.getElementById("scrim");
        if (scrim) scrim.classList.add("hidden");
      }
    }, 280);
  }

  /**
   * Closes all active sheets, inspection cards, and scrim.
   */
  function closeAllOverlays() {
    const landingOverlay = document.getElementById("landing-overlay");
    if (landingOverlay && !landingOverlay.classList.contains("hidden")) {
      dismissLandingOverlay();
    }

    const sheets = document.querySelectorAll(".sheet");
    sheets.forEach(s => {
      s.classList.remove("is-open");
      setTimeout(() => {
        s.classList.add("hidden");
      }, 280);
    });

    const scrim = document.getElementById("scrim");
    if (scrim) {
      scrim.classList.add("hidden");
    }

    if (state.targetMarker && state.map) {
      state.map.removeLayer(state.targetMarker);
      state.targetMarker = null;
    }
  }

  /**
   * Formats a timestamp into human-readable relative time string.
   * @param {number} ts - Epoch timestamp.
   * @returns {string} Relative time.
   */
  function relativeTime(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / (60 * 1000));
    const hours = Math.floor(diff / (60 * 60 * 1000));
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));

    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins} min ago`;
    if (hours < 24) return `${hours} hours ago`;
    if (days < 7) return `${days} days ago`;

    const d = new Date(ts);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  }

  /**
   * Formats a timestamp into local 12-hour clock format (e.g., "10:15 PM").
   * @param {number} ts - Epoch timestamp.
   * @returns {string} Formatted clock string.
   */
  function formatClock(ts) {
    const d = new Date(ts);
    let hours = d.getHours();
    const mins = d.getMinutes();
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    const padMins = mins < 10 ? "0" + mins : mins;
    return `${hours}:${padMins} ${ampm}`;
  }

  /**
   * Refreshes Lucide icons in the DOM and runs developer verification check.
   */
  function refreshIcons() {
    if (typeof lucide !== "undefined" && typeof lucide.createIcons === "function") {
      lucide.createIcons();

      // Developer verification check: ensure no unrendered icon tags remain
      const remaining = document.querySelectorAll("i[data-lucide]");
      if (remaining.length > 0) {
        console.warn("Unrendered Lucide icons found in DOM:", remaining);
      }
    }
  }

  // Application Startup Sequence
  initMap();
  initUI();
  bindEvents();
  renderReports();
});
