// Google sign-in via Supabase Auth, plus the player profile tab.
// The publishable key is meant to be public; it is safe to ship in browser code.
// Data access is protected by row-level security on the `profiles` table.
const SUPABASE_URL = "https://bkjajikcdsldpkulxxyx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Crxs_HTR20u9jKciIq3r8Q_9tYMfi0J";

(() => {
  const $ = (id) => document.getElementById(id);
  const loginEl = $("login");
  const appEl = $("app");
  const loginError = $("login-error");
  const greetingEl = $("greeting");
  const avatarEl = $("user-avatar");
  const signInBtn = $("google-signin");
  const signOutBtn = $("signout");

  const tabs = document.querySelectorAll(".tab");
  const panels = { table: $("table"), stats: $("stats"), profile: $("profile") };

  const pf = {
    loading: $("profile-loading"),
    form: $("profile-form"),
    heading: $("profile-heading"),
    intro: $("profile-intro"),
    preview: $("profile-preview"),
    avatar: $("pf-avatar"),
    username: $("pf-username"),
    display: $("pf-display"),
    bio: $("pf-bio"),
    bioCount: $("pf-bio-count"),
    message: $("profile-message"),
    save: $("profile-save"),
    memberSince: $("member-since"),
  };

  const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
  let currentUser = null;
  let profile = null; // row from public.profiles, or null if not created yet
  let loadedFor = null; // user id whose profile is loaded

  if (!window.supabase) {
    loginEl.hidden = false;
    signInBtn.disabled = true;
    loginError.textContent = "Couldn't load the sign-in service. Check your connection and refresh.";
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  // Shared with tracker.js and stats.js. They listen for "bj:user" and "bj:tab" events.
  window.BJ = { client, user: null };
  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

  // ---------- Helpers ----------

  function googleInfo(user) {
    const meta = user.user_metadata || {};
    return {
      name: meta.full_name || meta.name || (user.email || "").split("@")[0] || "Player",
      avatar: meta.avatar_url || meta.picture || "",
    };
  }

  function suggestUsername(user) {
    const base = (user.email || googleInfo(user).name)
      .split("@")[0]
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 20);
    return base.length >= 3 ? base : `player_${user.id.slice(0, 6)}`;
  }

  function timeGreeting() {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  }

  function setMessage(text, isError = false) {
    pf.message.textContent = text;
    pf.message.classList.toggle("error", isError);
  }

  // ---------- Tabs ----------

  function showTab(name) {
    tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
    Object.entries(panels).forEach(([key, el]) => (el.hidden = key !== name));
    emit("bj:tab", { tab: name });
  }
  tabs.forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));

  // ---------- Header ----------

  function renderHeader() {
    if (!currentUser) return;
    const g = googleInfo(currentUser);
    const fullName = profile?.display_name || g.name;
    const firstName = fullName.split(" ")[0];
    const avatar = profile ? profile.avatar_url : g.avatar;

    greetingEl.textContent = `${timeGreeting()}, ${firstName}! Good luck at the table.`;
    greetingEl.title = profile ? `@${profile.username}` : fullName;
    if (avatar) {
      avatarEl.src = avatar;
      avatarEl.alt = fullName;
      avatarEl.hidden = false;
    } else {
      avatarEl.removeAttribute("src");
      avatarEl.hidden = true;
    }
    $("tab-profile").classList.toggle("tab-dot", !profile);
  }

  // ---------- Profile ----------

  function fillForm() {
    const g = googleInfo(currentUser);
    const editing = Boolean(profile);
    pf.heading.textContent = editing ? "Your profile" : "Create your profile";
    pf.intro.textContent = editing
      ? "Update how you appear at the table."
      : "Welcome! Pick a username and tell the table a little about yourself.";
    pf.save.textContent = editing ? "Save changes" : "Create profile";
    pf.username.value = profile?.username ?? suggestUsername(currentUser);
    pf.display.value = profile?.display_name ?? g.name;
    pf.bio.value = profile?.bio ?? "";
    pf.avatar.value = profile ? profile.avatar_url || "" : g.avatar;
    pf.memberSince.textContent = editing
      ? `Member since ${new Date(profile.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`
      : "";
    updatePreview();
    updateBioCount();
    pf.username.removeAttribute("aria-invalid");
    setMessage("");
  }

  function updatePreview() {
    const url = pf.avatar.value.trim();
    if (url) pf.preview.src = url;
    else pf.preview.removeAttribute("src");
  }

  function updateBioCount() {
    pf.bioCount.textContent = `${pf.bio.value.length}/280`;
  }

  async function loadProfile(user) {
    loadedFor = user.id;
    pf.loading.hidden = false;
    pf.loading.textContent = "Loading your profile…";
    pf.form.hidden = true;

    const { data, error } = await client
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (loadedFor !== user.id) return; // user changed while loading
    if (error) {
      console.error(error);
      pf.loading.textContent = "Couldn't load your profile. Refresh to try again.";
      return;
    }
    profile = data;
    pf.loading.hidden = true;
    pf.form.hidden = false;
    fillForm();
    renderHeader();
    if (!profile) showTab("profile");
  }

  pf.avatar.addEventListener("input", updatePreview);
  pf.preview.addEventListener("error", () => pf.preview.removeAttribute("src"));
  pf.bio.addEventListener("input", updateBioCount);
  pf.username.addEventListener("input", () => {
    const cleaned = pf.username.value.toLowerCase().replace(/\s/g, "_");
    if (cleaned !== pf.username.value) pf.username.value = cleaned;
    pf.username.removeAttribute("aria-invalid");
  });

  pf.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const row = {
      id: currentUser.id,
      username: pf.username.value.trim(),
      display_name: pf.display.value.trim(),
      bio: pf.bio.value.trim() || null,
      avatar_url: pf.avatar.value.trim() || null,
    };

    if (!USERNAME_RE.test(row.username)) {
      pf.username.setAttribute("aria-invalid", "true");
      pf.username.focus();
      return setMessage("Username must be 3–20 lowercase letters, numbers or underscores.", true);
    }
    if (!row.display_name) {
      pf.display.focus();
      return setMessage("Please enter a display name.", true);
    }
    if (row.avatar_url && !/^https?:\/\//i.test(row.avatar_url)) {
      pf.avatar.focus();
      return setMessage("Photo URL must start with http:// or https://", true);
    }

    pf.save.disabled = true;
    setMessage("Saving…");
    const creating = !profile;
    const { data, error } = creating
      ? await client.from("profiles").insert(row).select().single()
      : await client.from("profiles").update(row).eq("id", currentUser.id).select().single();
    pf.save.disabled = false;

    if (error) {
      console.error(error);
      if (error.code === "23505") {
        pf.username.setAttribute("aria-invalid", "true");
        pf.username.focus();
        return setMessage("That username is taken. Try another.", true);
      }
      return setMessage(`Couldn't save your profile: ${error.message}`, true);
    }

    profile = data;
    fillForm();
    renderHeader();
    setMessage(creating ? "Profile created! Head to the Table to play." : "Profile saved.");
  });

  // ---------- Session ----------

  function render(session) {
    const user = session?.user ?? null;
    if (!user) {
      if (currentUser) {
        window.BJ.user = null;
        emit("bj:user", { user: null });
      }
      currentUser = null;
      profile = null;
      loadedFor = null;
      avatarEl.removeAttribute("src");
      appEl.hidden = true;
      loginEl.hidden = false;
      return;
    }
    const isNewUser = user.id !== currentUser?.id;
    currentUser = user;
    loginEl.hidden = true;
    appEl.hidden = false;
    if (isNewUser) {
      window.BJ.user = user;
      emit("bj:user", { user });
      profile = null;
      showTab("table");
      renderHeader();
      loadProfile(user);
    }
  }

  // Wait until every script on the page (tracker, stats) has loaded and is listening,
  // and keep the profile fetch out of the auth callback (recommended by supabase-js).
  const pageReady = new Promise((resolve) =>
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", resolve, { once: true }) : resolve()
  );
  const renderWhenReady = (session) => pageReady.then(() => setTimeout(() => render(session), 0));
  client.auth.onAuthStateChange((_event, session) => renderWhenReady(session));
  client.auth.getSession().then(({ data }) => renderWhenReady(data.session));

  signInBtn.addEventListener("click", async () => {
    loginError.textContent = "";
    signInBtn.disabled = true;
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) {
      loginError.textContent = error.message;
      signInBtn.disabled = false;
    }
  });

  signOutBtn.addEventListener("click", async () => {
    await client.auth.signOut();
    render(null);
  });
})();
