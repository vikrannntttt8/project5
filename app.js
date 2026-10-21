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
    authMode: "magic-link"
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
    // Welcome Sheet Open Map Button
    const btnOpenMap = document.getElementById("btn-open-map");
    if (btnOpenMap) {
      btnOpenMap.addEventListener("click", () => {
        try {
          localStorage.setItem("jugnu_onboarded", "1");
        } catch {
          // Ignore storage restrictions
        }
        closeSheet(document.getElementById("welcome-sheet"));
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

    // Search Input Form (Submit Only)
    const searchForm = document.getElementById("search-form");
    const searchInput = document.getElementById("search-input");
    const searchClear = document.getElementById("search-clear");

    if (searchForm && searchInput) {
      searchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (query.length > 0) {
          runSearch(query);
        }
      });

      searchInput.addEventListener("input", () => {
        if (searchInput.value.length > 0) {
          searchClear?.classList.remove("hidden");
        } else {
          searchClear?.classList.add("hidden");
          const searchResults = document.getElementById("search-results");
          if (searchResults) searchResults.classList.add("hidden");
        }
      });
    }

    if (searchClear && searchInput) {
      searchClear.addEventListener("click", () => {
        searchInput.value = "";
        searchClear.classList.add("hidden");
        const searchResults = document.getElementById("search-results");
        if (searchResults) searchResults.classList.add("hidden");
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
        openSheet(document.getElementById("auth-modal"));
      });
    }

    const btnCloseAuth = document.getElementById("btn-close-auth");
    if (btnCloseAuth) {
      btnCloseAuth.addEventListener("click", () => {
        closeSheet(document.getElementById("auth-modal"));
      });
    }

    // Auth Mode Tabs (Magic Link vs Email & Password)
    const tabMagicLink = document.getElementById("tab-magic-link");
    const tabPassword = document.getElementById("tab-password");
    const groupPassword = document.getElementById("group-password");
    const btnAuthLabel = document.getElementById("btn-auth-label");

    if (tabMagicLink && tabPassword) {
      tabMagicLink.addEventListener("click", () => {
        tabMagicLink.classList.add("is-active");
        tabMagicLink.setAttribute("aria-selected", "true");
        tabPassword.classList.remove("is-active");
        tabPassword.setAttribute("aria-selected", "false");
        groupPassword?.classList.add("hidden");
        const authPassword = document.getElementById("auth-password");
        if (authPassword) authPassword.required = false;
        if (btnAuthLabel) btnAuthLabel.textContent = "Send Magic Link";
        state.authMode = "magic-link";
      });

      tabPassword.addEventListener("click", () => {
        tabPassword.classList.add("is-active");
        tabPassword.setAttribute("aria-selected", "true");
        tabMagicLink.classList.remove("is-active");
        tabMagicLink.setAttribute("aria-selected", "false");
        groupPassword?.classList.remove("hidden");
        const authPassword = document.getElementById("auth-password");
        if (authPassword) authPassword.required = true;
        if (btnAuthLabel) btnAuthLabel.textContent = "Sign In or Sign Up";
        state.authMode = "password";
      });
    }

    // Auth Form Submission
    const authForm = document.getElementById("auth-form");
    if (authForm) {
      authForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const emailInput = document.getElementById("auth-email");
        const passInput = document.getElementById("auth-password");
        const email = emailInput ? emailInput.value.trim() : "";
        const password = passInput ? passInput.value : "";

        if (!email) {
          showToast("Please enter a valid email address.");
          return;
        }

        if (!store.isConfigured()) {
          showToast("Supabase is not configured. Add your Project URL and Key in data.js to enable cloud auth.");
          return;
        }

        const submitBtn = document.getElementById("btn-auth-submit");
        if (submitBtn) submitBtn.disabled = true;

        try {
          if (state.authMode === "magic-link") {
            await store.signInWithOtp(email);
            showToast("Magic link sent. Check your inbox to sign in.");
            closeSheet(document.getElementById("auth-modal"));
          } else {
            // Password mode: attempt signIn first, fallback to signUp if credentials not found
            try {
              await store.signInWithPassword(email, password);
              showToast("Signed in successfully.");
              const user = await store.getCurrentUser();
              updateAuthUI(user);
              closeSheet(document.getElementById("auth-modal"));
            } catch (signInErr) {
              if (signInErr.message && (signInErr.message.includes("Invalid login credentials") || signInErr.message.includes("User not found"))) {
                try {
                  await store.signUpWithPassword(email, password);
                  showToast("Account created. Check your email for confirmation.");
                  const user = await store.getCurrentUser();
                  updateAuthUI(user);
                  closeSheet(document.getElementById("auth-modal"));
                } catch (signUpErr) {
                  showToast(signUpErr.message || "Authentication failed.");
                }
              } else {
                showToast(signInErr.message || "Authentication failed.");
              }
            }
          }
        } catch (err) {
          showToast(err.message || "Sign in failed. Check your connection.");
        } finally {
          if (submitBtn) submitBtn.disabled = false;
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
   * Displays the Welcome Sheet if the user has not dismissed it before.
   */
  function maybeShowWelcome() {
    let onboarded = false;
    try {
      onboarded = localStorage.getItem("jugnu_onboarded") === "1";
    } catch {
      onboarded = false;
    }

    const welcomeSheet = document.getElementById("welcome-sheet");
    if (!welcomeSheet) return;

    if (!onboarded) {
      openSheet(welcomeSheet);
    } else {
      welcomeSheet.classList.remove("is-open");
      welcomeSheet.classList.add("hidden");
    }
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

    if (user && user.email) {
      if (authUserView) authUserView.classList.remove("hidden");
      if (authLoginView) authLoginView.classList.add("hidden");

      const initial = user.email.charAt(0).toUpperCase();
      if (authUserEmail) authUserEmail.textContent = user.email;
      if (authAvatarInitials) authAvatarInitials.textContent = initial;

      if (accountLabel) accountLabel.textContent = user.email.split("@")[0];
      if (accountAvatar) {
        accountAvatar.innerHTML = `<div class="account-avatar-badge">${initial}</div>`;
      }
    } else {
      if (authUserView) authUserView.classList.add("hidden");
      if (authLoginView) authLoginView.classList.remove("hidden");

      if (accountLabel) accountLabel.textContent = "Sign In";
      if (accountAvatar) {
        accountAvatar.innerHTML = '<i data-lucide="user"></i>';
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
   * @param {L.LatLng|Object} latlng - Target coordinates.
   */
  function placeTarget(latlng) {
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
     Section: Search
     ========================================================================== */

  /**
   * Runs place search using OpenStreetMap Nominatim API biased toward Mumbai.
   * @param {string} query - Location search query.
   */
  async function runSearch(query) {
    const searchResults = document.getElementById("search-results");
    if (!searchResults) return;

    searchResults.innerHTML = `
      <div class="search-status">
        <i data-lucide="loader-circle" class="spin"></i>
        <span>Searching...</span>
      </div>
    `;
    searchResults.classList.remove("hidden");
    refreshIcons();

    // Abort previous in-flight request if any
    if (state.searchAbortController) {
      state.searchAbortController.abort();
    }
    state.searchAbortController = new AbortController();

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&countrycodes=in&viewbox=72.75,19.35,73.05,18.85&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        signal: state.searchAbortController.signal,
        headers: { "Accept-Language": "en" }
      });

      if (!res.ok) throw new Error("Search network error");
      const items = await res.json();
      renderSearchResults(items);
    } catch (err) {
      if (err.name === "AbortError") return;
      searchResults.classList.add("hidden");
      showToast("Search failed. Check your internet connection.");
    }
  }

  /**
   * Renders up to 5 location results in the dropdown.
   * @param {Array<Object>} items - Nominatim search results.
   */
  function renderSearchResults(items) {
    const searchResults = document.getElementById("search-results");
    if (!searchResults) return;

    searchResults.innerHTML = "";

    if (!Array.isArray(items) || items.length === 0) {
      searchResults.innerHTML = `
        <div class="search-status">
          <span>No places found. Try a nearby station or college.</span>
        </div>
      `;
      return;
    }

    items.forEach(item => {
      const parts = item.display_name.split(",").map(p => p.trim());
      const primaryName = parts.slice(0, 2).join(", ");
      const subName = parts.slice(2).join(", ");

      const row = document.createElement("button");
      row.type = "button";
      row.className = "search-item";
      row.innerHTML = `
        <span class="search-item-primary">${primaryName}</span>
        <span class="search-item-sub">${subName}</span>
      `;

      row.addEventListener("click", () => {
        flyToResult(item);
      });

      searchResults.appendChild(row);
    });
  }

  /**
   * Flies map to chosen search result and flashes temporary amber ring.
   * @param {Object} item - Chosen search item.
   */
  function flyToResult(item) {
    const lat = parseFloat(item.lat);
    const lon = parseFloat(item.lon);
    if (isNaN(lat) || isNaN(lon) || !state.map) return;

    const searchResults = document.getElementById("search-results");
    if (searchResults) searchResults.classList.add("hidden");

    state.map.flyTo([lat, lon], 16, { duration: 1.5 });

    // Show temporary amber ring marker for 6 seconds
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
