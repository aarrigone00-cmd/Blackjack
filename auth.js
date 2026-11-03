// Google sign-in via Supabase Auth.
// The publishable key is meant to be public; it is safe to ship in browser code.
const SUPABASE_URL = "https://bkjajikcdsldpkulxxyx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Crxs_HTR20u9jKciIq3r8Q_9tYMfi0J";

(() => {
  const loginEl = document.getElementById("login");
  const tableEl = document.getElementById("table");
  const loginError = document.getElementById("login-error");
  const greetingEl = document.getElementById("greeting");
  const avatarEl = document.getElementById("user-avatar");
  const signInBtn = document.getElementById("google-signin");
  const signOutBtn = document.getElementById("signout");

  if (!window.supabase) {
    loginEl.hidden = false;
    signInBtn.disabled = true;
    loginError.textContent = "Couldn't load the sign-in service. Check your connection and refresh.";
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  function greetingFor(hour) {
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }

  function showUser(user) {
    const meta = user.user_metadata || {};
    const fullName = meta.full_name || meta.name || user.email || "player";
    const firstName = fullName.split(" ")[0];
    const avatar = meta.avatar_url || meta.picture;

    greetingEl.textContent = `${greetingFor(new Date().getHours())}, ${firstName}! Good luck at the table.`;
    greetingEl.title = fullName;
    if (avatar) {
      avatarEl.src = avatar;
      avatarEl.alt = fullName;
      avatarEl.hidden = false;
    } else {
      avatarEl.hidden = true;
    }
    loginEl.hidden = true;
    tableEl.hidden = false;
  }

  function showLogin() {
    avatarEl.removeAttribute("src");
    tableEl.hidden = true;
    loginEl.hidden = false;
  }

  function render(session) {
    if (session?.user) showUser(session.user);
    else showLogin();
  }

  client.auth.onAuthStateChange((_event, session) => render(session));
  client.auth.getSession().then(({ data }) => render(data.session));

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
    showLogin();
  });
})();
