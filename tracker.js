// Saves every hand to Supabase and manages the player's named strategies.
window.Tracker = (() => {
  const $ = (id) => document.getElementById(id);
  const select = $("strategy-select");
  const newForm = $("strategy-new");
  const newName = $("strategy-name");
  const saveStatus = $("save-status");
  const NEW_VALUE = "__new__";

  let user = null;
  let strategies = [];
  let selectedId = "";
  let lastSelectValue = "";
  const listeners = new Set();

  const client = () => window.BJ?.client;
  const storageKey = () => `bj:strategy:${user?.id}`;

  function notify() {
    listeners.forEach((fn) => fn());
  }

  function status(text, isError = false) {
    saveStatus.textContent = text;
    saveStatus.classList.toggle("error", isError);
  }

  function renderSelect() {
    select.replaceChildren();
    const add = (value, label) => {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      select.append(o);
    };
    add("", "No strategy");
    strategies.forEach((s) => add(s.id, s.name));
    add(NEW_VALUE, "＋ New strategy…");
    if (!strategies.some((s) => s.id === selectedId)) selectedId = "";
    select.value = selectedId;
    lastSelectValue = selectedId;
  }

  async function loadStrategies() {
    const { data, error } = await client().from("strategies").select("id,name,description,created_at").order("created_at");
    if (error) throw error;
    strategies = data;
    try {
      selectedId = localStorage.getItem(storageKey()) || "";
    } catch {
      selectedId = "";
    }
    renderSelect();
    notify();
  }

  async function loadLastBank() {
    const { data, error } = await client()
      .from("hands")
      .select("bank_after")
      .order("played_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data && window.Game) window.Game.restoreBank(data.bank_after);
  }

  function choose(id) {
    selectedId = id;
    lastSelectValue = id;
    try {
      localStorage.setItem(storageKey(), id);
    } catch {}
  }

  select.addEventListener("change", () => {
    if (select.value === NEW_VALUE) {
      select.value = lastSelectValue;
      newForm.hidden = false;
      newName.value = "";
      newName.focus();
      return;
    }
    choose(select.value);
  });

  $("strategy-cancel").addEventListener("click", () => {
    newForm.hidden = true;
  });

  newForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = newName.value.trim();
    if (!name) return newName.focus();
    const existing = strategies.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      choose(existing.id);
      renderSelect();
      newForm.hidden = true;
      return;
    }
    const { data, error } = await client().from("strategies").insert({ name }).select().single();
    if (error) return status(`Couldn't create strategy: ${error.message}`, true);
    strategies.push(data);
    choose(data.id);
    renderSelect();
    newForm.hidden = true;
    status(`Now tracking hands under “${data.name}”.`);
    notify();
  });

  document.addEventListener("bj:user", async (e) => {
    user = e.detail.user;
    strategies = [];
    selectedId = "";
    newForm.hidden = true;
    status("");
    renderSelect();
    if (!user) return;
    try {
      await Promise.all([loadStrategies(), loadLastBank()]);
    } catch (err) {
      console.error(err);
      status("Couldn't load your strategies.", true);
    }
  });

  async function recordHand(hand, actions) {
    if (!user || !client()) return;
    const payload = { ...hand, strategy_id: selectedId || null };
    for (let attempt = 0; attempt < 2; attempt++) {
      const { error } = await client().rpc("record_hand", { hand: payload, actions });
      if (!error) {
        status("Hand saved ✓");
        notify();
        return;
      }
      console.error(error);
    }
    status("Couldn't save that hand. Check your connection.", true);
  }

  return {
    recordHand,
    get strategies() {
      return strategies;
    },
    onChange(fn) {
      listeners.add(fn);
    },
  };
})();
