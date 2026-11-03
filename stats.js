// Stats tab: loads the player's hands and decisions from Supabase and turns them
// into KPIs, charts, breakdowns and auto-generated insights.
(() => {
  const $ = (id) => document.getElementById(id);
  const els = {
    strategy: $("stats-strategy"),
    range: $("stats-range"),
    status: $("stats-status"),
    body: $("stats-body"),
    kpis: $("kpis"),
    insights: $("insights"),
    netChart: $("net-chart"),
    upChart: $("upcard-chart"),
    upTable: $("upcard-table"),
    adherence: $("adherence-table"),
    deviations: $("deviation-table"),
    start: $("start-table"),
    strategies: $("strategy-table"),
    recent: $("recent-table"),
    tip: $("chart-tip"),
  };
  const SVG = "http://www.w3.org/2000/svg";
  const PAGE = 1000;

  let user = null;
  let hands = []; // all hands, oldest first, each with .actions
  let loaded = false;
  let stale = true;
  let visible = false;
  let loading = null;

  // ---------- Formatting ----------

  const money = (n) => `${n < 0 ? "−" : n > 0 ? "+" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;
  const plain$ = (n) => `$${Math.round(n).toLocaleString()}`;
  const pct = (n) => (Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—");
  const per = (n) => (Number.isFinite(n) ? money(n) : "—");
  const upLabel = (v) => (v === 11 ? "A" : String(v));
  const handLabel = (total, soft) => `${soft ? "Soft" : "Hard"} ${total}`;
  const SUITS = { S: "♠", H: "♥", D: "♦", C: "♣" };
  const cardText = (code) => `${code[0] === "0" ? "10" : code[0]}${SUITS[code[1]] || code[1]}`;
  const ACTION = { hit: "Hit", stand: "Stand", double: "Double" };
  const OUTCOME = { blackjack: "Blackjack", win: "Win", push: "Push", loss: "Loss" };

  // ---------- Data ----------

  async function fetchAll(table, columns, order) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await BJ.client
        .from(table)
        .select(columns)
        .order(order, { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < PAGE) return out;
    }
  }

  async function load() {
    if (!user) return;
    if (loading) return loading;
    els.status.hidden = false;
    els.status.textContent = loaded ? "Refreshing…" : "Loading your stats…";
    const forUser = user.id;
    loading = (async () => {
      try {
        const [h, a] = await Promise.all([
          fetchAll("hands", "*", "played_at"),
          fetchAll("hand_actions", "hand_id,seq,action,player_total,player_soft,card_count,dealer_upcard_value,recommended_action,matches_basic,card_drawn,total_after", "id"),
        ]);
        if (user?.id !== forUser) return;
        const byHand = new Map();
        for (const act of a) {
          if (!byHand.has(act.hand_id)) byHand.set(act.hand_id, []);
          byHand.get(act.hand_id).push(act);
        }
        h.forEach((hand) => (hand.actions = (byHand.get(hand.id) || []).sort((x, y) => x.seq - y.seq)));
        hands = h;
        loaded = true;
        stale = false;
        render();
      } catch (err) {
        console.error(err);
        els.status.textContent = "Couldn't load your stats. Try again in a moment.";
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  function strategyName(id) {
    return Tracker.strategies.find((s) => s.id === id)?.name || "Deleted strategy";
  }

  function renderStrategyFilter() {
    const current = els.strategy.value || "all";
    els.strategy.replaceChildren();
    const add = (value, label) => {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      els.strategy.append(o);
    };
    add("all", "All hands");
    add("none", "No strategy");
    Tracker.strategies.forEach((s) => add(s.id, s.name));
    els.strategy.value = [...els.strategy.options].some((o) => o.value === current) ? current : "all";
  }

  function filtered() {
    const s = els.strategy.value;
    const days = els.range.value;
    const since = days === "all" ? 0 : Date.now() - Number(days) * 864e5;
    return hands.filter(
      (h) =>
        (s === "all" || (s === "none" ? !h.strategy_id : h.strategy_id === s)) &&
        new Date(h.played_at).getTime() >= since
    );
  }

  // ---------- Metrics ----------

  const isWin = (h) => h.outcome === "win" || h.outcome === "blackjack";

  function summarize(list) {
    const n = list.length;
    const wins = list.filter(isWin).length;
    const pushes = list.filter((h) => h.outcome === "push").length;
    const net = list.reduce((t, h) => t + h.net, 0);
    const wagered = list.reduce((t, h) => t + h.final_bet, 0);
    const decisions = list.flatMap((h) => h.actions);
    const graded = decisions.filter((a) => a.matches_basic !== null);
    return {
      n,
      wins,
      losses: list.filter((h) => h.outcome === "loss").length,
      pushes,
      net,
      wagered,
      winRate: n ? wins / n : NaN,
      roi: wagered ? net / wagered : NaN,
      perHand: n ? net / n : NaN,
      accuracy: graded.length ? graded.filter((a) => a.matches_basic).length / graded.length : NaN,
    };
  }

  function streaks(list) {
    let bestW = 0, bestL = 0, run = 0, kind = null;
    for (const h of list) {
      if (h.outcome === "push") continue;
      const k = isWin(h) ? "W" : "L";
      run = k === kind ? run + 1 : 1;
      kind = k;
      if (k === "W") bestW = Math.max(bestW, run);
      else bestL = Math.max(bestL, run);
    }
    return { bestW, bestL, current: kind ? `${run}${kind}` : "—" };
  }

  function groupBy(list, keyFn) {
    const m = new Map();
    for (const item of list) {
      const k = keyFn(item);
      if (k == null) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(item);
    }
    return m;
  }

  function startBucket(h) {
    if (h.player_blackjack) return "Blackjack (A + 10)";
    const t = h.player_start_total;
    if (h.player_start_soft) return t >= 19 ? "Soft 19–20" : t === 12 ? "Pair of aces" : `Soft ${t}`;
    if (t <= 8) return "Hard 5–8";
    if (t >= 17) return "Hard 17–20";
    return `Hard ${t}`;
  }
  const BUCKET_ORDER = [
    "Hard 5–8", "Hard 9", "Hard 10", "Hard 11", "Hard 12", "Hard 13", "Hard 14", "Hard 15", "Hard 16",
    "Hard 17–20", "Pair of aces", "Soft 13", "Soft 14", "Soft 15", "Soft 16", "Soft 17", "Soft 18",
    "Soft 19–20", "Blackjack (A + 10)",
  ];

  // ---------- DOM helpers ----------

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else node.setAttribute(k, v);
    });
    children.flat().forEach((c) => node.append(c instanceof Node ? c : document.createTextNode(String(c))));
    return node;
  }

  function svg(tag, attrs = {}) {
    const node = document.createElementNS(SVG, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  }

  function table(target, headers, rows, emptyText = "Not enough data yet.") {
    target.replaceChildren();
    if (!rows.length) {
      target.append(el("tbody", {}, el("tr", {}, el("td", { class: "empty" }, emptyText))));
      return;
    }
    target.append(
      el("thead", {}, el("tr", {}, headers.map((h, i) => el("th", i ? { class: "num" } : {}, h)))),
      el(
        "tbody",
        {},
        rows.map((r) =>
          el(
            "tr",
            {},
            r.map((cell, i) => {
              const td = el("td", i ? { class: "num" } : {});
              if (cell && typeof cell === "object" && "text" in cell) {
                td.textContent = cell.text;
                if (cell.tone) td.classList.add(cell.tone);
              } else td.textContent = cell;
              return td;
            })
          )
        )
      )
    );
  }

  const signed = (n, text = money(n)) => ({ text, tone: n > 0 ? "pos" : n < 0 ? "neg" : "" });

  function showTip(evt, lines) {
    els.tip.replaceChildren(
      el("strong", {}, lines[0]),
      ...lines.slice(1).map((l) => el("div", {}, l))
    );
    els.tip.hidden = false;
    const r = els.tip.getBoundingClientRect();
    let x = evt.clientX + 14;
    let y = evt.clientY + 14;
    if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - 14;
    els.tip.style.left = `${Math.max(8, x)}px`;
    els.tip.style.top = `${Math.max(8, y)}px`;
  }
  const hideTip = () => (els.tip.hidden = true);

  // ---------- Render ----------

  function render() {
    if (!loaded) return;
    renderStrategyFilter();
    const list = filtered();
    els.status.hidden = true;
    els.body.hidden = false;
    if (!hands.length) {
      els.status.hidden = false;
      els.status.textContent = "No hands recorded yet. Play a few on the Table tab and your stats will appear here.";
      els.body.hidden = true;
      return;
    }
    if (!list.length) {
      els.status.hidden = false;
      els.status.textContent = "No hands match these filters.";
      els.body.hidden = true;
      return;
    }
    renderKpis(list);
    renderInsights(list);
    renderNetChart(list);
    renderUpcards(list);
    renderDecisions(list);
    renderStarts(list);
    renderStrategies();
    renderRecent(list);
  }

  function renderKpis(list) {
    const s = summarize(list);
    const st = streaks(list);
    const bj = list.filter((h) => h.outcome === "blackjack").length;
    const busts = list.filter((h) => h.player_bust).length;
    const dealerBusts = list.filter((h) => h.dealer_bust).length;
    const doubles = list.filter((h) => h.doubled);
    const best = Math.max(...list.map((h) => h.net));
    const worst = Math.min(...list.map((h) => h.net));
    const tiles = [
      ["Hands played", s.n.toLocaleString(), `${s.wins} W · ${s.losses} L · ${s.pushes} P`],
      ["Net result", money(s.net), `${per(s.perHand)} per hand`, s.net],
      ["Win rate", pct(s.winRate), `Push rate ${pct(s.pushes / s.n)}`],
      ["Return on wagers", pct(s.roi), `${plain$(s.wagered)} wagered`, s.roi],
      ["Average bet", plain$(s.wagered / s.n), `Opening bet ${plain$(list.reduce((t, h) => t + h.bet, 0) / s.n)}`],
      ["Basic strategy match", pct(s.accuracy), `${list.reduce((t, h) => t + h.decisions, 0)} decisions graded`],
      ["Blackjacks", bj.toLocaleString(), `${pct(bj / s.n)} of hands`],
      ["You bust", pct(busts / s.n), `Dealer busts ${pct(dealerBusts / s.n)}`],
      ["Double downs", doubles.length.toLocaleString(), doubles.length ? `Won ${pct(doubles.filter(isWin).length / doubles.length)}` : "None yet"],
      ["Streaks", st.current, `Best ${st.bestW}W · Worst ${st.bestL}L`],
      ["Biggest win", money(best), "single hand", best],
      ["Biggest loss", money(worst), "single hand", worst],
    ];
    els.kpis.replaceChildren(
      ...tiles.map(([label, value, sub, sign]) => {
        const v = el("div", { class: "kpi-value" }, value);
        if (sign > 0) v.classList.add("pos");
        if (sign < 0) v.classList.add("neg");
        return el("div", { class: "kpi" }, el("div", { class: "kpi-label" }, label), v, el("div", { class: "kpi-sub" }, sub));
      })
    );
  }

  function renderInsights(list) {
    const s = summarize(list);
    const out = [];
    if (s.n < 50) out.push(`Only ${s.n} hand${s.n === 1 ? "" : "s"} so far. Patterns get reliable after a few hundred, so treat these as early signals.`);

    out.push(
      `You're ${s.net >= 0 ? "up" : "down"} ${plain$(Math.abs(s.net))} over ${s.n} hands, a ${pct(s.roi)} return on ${plain$(s.wagered)} wagered. ` +
        `Perfect basic strategy at this table loses roughly 0.5–1% over the long run.`
    );

    // Basic strategy adherence and its payoff
    const followed = list.filter((h) => h.decisions > 0 && h.basic_strategy_deviations === 0);
    const deviated = list.filter((h) => h.basic_strategy_deviations > 0);
    if (Number.isFinite(s.accuracy)) {
      let line = `You matched basic strategy on ${pct(s.accuracy)} of decisions.`;
      if (followed.length >= 5 && deviated.length >= 5) {
        const f = summarize(followed), d = summarize(deviated);
        line += ` Hands where you followed it returned ${per(f.perHand)} per hand vs ${per(d.perHand)} when you deviated.`;
      }
      out.push(line);
    }

    // Most common deviation
    const devs = list.flatMap((h) => h.actions.filter((a) => a.matches_basic === false).map((a) => ({ a, h })));
    if (devs.length) {
      const g = [...groupBy(devs, ({ a }) => `${handLabel(a.player_total, a.player_soft)}|${a.dealer_upcard_value}|${a.action}|${a.recommended_action}`)].sort(
        (x, y) => y[1].length - x[1].length
      )[0];
      const [hand, up, act, rec] = g[0].split("|");
      const net = g[1].reduce((t, { h }) => t + h.net, 0);
      out.push(
        `Your most common deviation: you ${ACTION[act].toLowerCase()} on ${hand.toLowerCase()} vs a dealer ${upLabel(+up)} (the chart says ${ACTION[rec].toLowerCase()}). ` +
          `That happened ${g[1].length} time${g[1].length === 1 ? "" : "s"}, netting ${money(net)}.`
      );
    }

    // Stiff hands (12–16) vs strong dealer cards
    const stiff = list.flatMap((h) => h.actions.filter((a) => !a.player_soft && a.player_total >= 12 && a.player_total <= 16 && a.dealer_upcard_value >= 7 && a.seq === 1));
    if (stiff.length >= 5) {
      const stood = stiff.filter((a) => a.action === "stand").length;
      out.push(`With a stiff hand (hard 12–16) against a dealer 7 or higher, you stood ${pct(stood / stiff.length)} of the time. Basic strategy hits every one of those.`);
    }

    // Dealer upcards
    const ups = [...groupBy(list, (h) => h.dealer_upcard_value)].filter(([, v]) => v.length >= 5).map(([k, v]) => [k, summarize(v)]);
    if (ups.length >= 2) {
      ups.sort((a, b) => b[1].perHand - a[1].perHand);
      const [bk, bs] = ups[0], [wk, ws] = ups[ups.length - 1];
      out.push(`You do best against a dealer ${upLabel(bk)} (${per(bs.perHand)} per hand) and worst against a dealer ${upLabel(wk)} (${per(ws.perHand)} per hand).`);
    }

    // Bet sizing after wins vs losses
    const after = { win: [], loss: [] };
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      if (prev.outcome === "push") continue;
      after[isWin(prev) ? "win" : "loss"].push(list[i].bet);
    }
    if (after.win.length >= 5 && after.loss.length >= 5) {
      const avg = (a) => a.reduce((t, x) => t + x, 0) / a.length;
      const aw = avg(after.win), al = avg(after.loss);
      const diff = (al - aw) / aw;
      if (Math.abs(diff) >= 0.15) {
        out.push(
          diff > 0
            ? `You bet ${pct(diff)} more after a loss (${plain$(al)}) than after a win (${plain$(aw)}). That's a loss-chasing pattern worth watching.`
            : `You bet ${pct(-diff)} more after a win (${plain$(aw)}) than after a loss (${plain$(al)}), pressing your bets on a heater.`
        );
      } else {
        out.push(`Your bet size stays steady whether you just won (${plain$(aw)}) or lost (${plain$(al)}).`);
      }
    }

    // Doubles
    const doubles = list.filter((h) => h.doubled);
    if (doubles.length >= 5) {
      const d = summarize(doubles);
      out.push(`Your doubles win ${pct(d.winRate)} of the time and return ${per(d.perHand)} per hand.`);
    }

    // Best strategy
    const strat = [...groupBy(hands, (h) => h.strategy_id || "none")].filter(([, v]) => v.length >= 10).map(([k, v]) => [k, summarize(v)]);
    if (strat.length >= 2) {
      strat.sort((a, b) => b[1].perHand - a[1].perHand);
      const name = (k) => (k === "none" ? "No strategy" : strategyName(k));
      out.push(`Best-performing strategy so far: “${name(strat[0][0])}” at ${per(strat[0][1].perHand)} per hand, vs “${name(strat[strat.length - 1][0])}” at ${per(strat[strat.length - 1][1].perHand)}.`);
    }

    els.insights.replaceChildren(...out.map((t) => el("li", {}, t)));
  }

  function renderNetChart(list) {
    const W = 760, H = 260, m = { t: 16, r: 16, b: 32, l: 64 };
    const pts = [{ i: 0, v: 0 }];
    let run = 0;
    list.forEach((h, idx) => {
      run += h.net;
      pts.push({ i: idx + 1, v: run, h });
    });
    const min = Math.min(0, ...pts.map((p) => p.v));
    const max = Math.max(0, ...pts.map((p) => p.v));
    const span = max - min || 1;
    const x = (i) => m.l + (i / Math.max(1, list.length)) * (W - m.l - m.r);
    const y = (v) => m.t + (1 - (v - min) / span) * (H - m.t - m.b);

    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Running net result: ${money(run)} after ${list.length} hands` });
    // grid + y labels
    const ticks = niceTicks(min, max, 4);
    ticks.forEach((t) => {
      root.append(svg("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: t === 0 ? "axis-zero" : "grid" }));
      const lbl = svg("text", { x: m.l - 8, y: y(t) + 4, class: "tick", "text-anchor": "end" });
      lbl.textContent = money(t);
      root.append(lbl);
    });
    const xl = svg("text", { x: W - m.r, y: H - 8, class: "tick", "text-anchor": "end" });
    xl.textContent = `Hand ${list.length}`;
    const x0 = svg("text", { x: m.l, y: H - 8, class: "tick" });
    x0.textContent = "Start";
    root.append(xl, x0);

    root.append(svg("path", { d: pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(""), class: "line" }));
    const last = pts[pts.length - 1];
    root.append(svg("circle", { cx: x(last.i), cy: y(last.v), r: 4, class: "dot" }));
    const endLbl = svg("text", { x: Math.min(x(last.i), W - m.r - 4), y: y(last.v) - 10, class: "tick strong", "text-anchor": "end" });
    endLbl.textContent = money(last.v);
    root.append(endLbl);

    // crosshair
    const hair = svg("line", { y1: m.t, y2: H - m.b, class: "hair", visibility: "hidden" });
    const marker = svg("circle", { r: 5, class: "dot ring", visibility: "hidden" });
    const hit = svg("rect", { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: "transparent", tabindex: 0 });
    root.append(hair, marker, hit);
    const at = (evt) => {
      const r = root.getBoundingClientRect();
      const px = ((evt.clientX - r.left) / r.width) * W;
      const i = Math.round(((px - m.l) / (W - m.l - m.r)) * list.length);
      return pts[Math.max(0, Math.min(pts.length - 1, i))];
    };
    const show = (p, evt) => {
      hair.setAttribute("x1", x(p.i));
      hair.setAttribute("x2", x(p.i));
      marker.setAttribute("cx", x(p.i));
      marker.setAttribute("cy", y(p.v));
      hair.setAttribute("visibility", "visible");
      marker.setAttribute("visibility", "visible");
      const lines = [money(p.v), p.h ? `Hand ${p.i} · ${new Date(p.h.played_at).toLocaleString()}` : "Start"];
      if (p.h) lines.push(`${OUTCOME[p.h.outcome]} ${money(p.h.net)} on a ${plain$(p.h.final_bet)} bet`);
      showTip(evt, lines);
    };
    hit.addEventListener("pointermove", (e) => show(at(e), e));
    hit.addEventListener("pointerleave", () => {
      hair.setAttribute("visibility", "hidden");
      marker.setAttribute("visibility", "hidden");
      hideTip();
    });
    els.netChart.replaceChildren(root);
  }

  function niceTicks(min, max, count) {
    const span = max - min || 1;
    const raw = span / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw);
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v));
    if (!out.includes(0)) out.push(0);
    return out;
  }

  function renderUpcards(list) {
    const groups = groupBy(list, (h) => h.dealer_upcard_value);
    const ups = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const W = 760, H = 220, m = { t: 24, r: 8, b: 28, l: 8 };
    const bw = (W - m.l - m.r) / ups.length;
    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Win rate by dealer upcard" });
    const y = (v) => m.t + (1 - v) * (H - m.t - m.b);
    root.append(svg("line", { x1: m.l, x2: W - m.r, y1: y(0), y2: y(0), class: "axis-zero" }));
    root.append(svg("line", { x1: m.l, x2: W - m.r, y1: y(0.5), y2: y(0.5), class: "grid" }));
    const half = svg("text", { x: W - m.r, y: y(0.5) - 4, class: "tick", "text-anchor": "end" });
    half.textContent = "50%";
    root.append(half);

    ups.forEach((u, i) => {
      const g = groups.get(u) || [];
      const s = summarize(g);
      const cx = m.l + i * bw;
      const label = svg("text", { x: cx + bw / 2, y: H - 8, class: "tick", "text-anchor": "middle" });
      label.textContent = upLabel(u);
      root.append(label);
      if (!g.length) return;
      const top = y(s.winRate);
      const h = Math.max(0, y(0) - top);
      const bar = svg("path", { d: roundedTop(cx + bw * 0.2, top, bw * 0.6, h, 4), class: "bar" });
      const val = svg("text", { x: cx + bw / 2, y: top - 6, class: "tick strong", "text-anchor": "middle" });
      val.textContent = `${Math.round(s.winRate * 100)}%`;
      const hit = svg("rect", { x: cx, y: m.t - 20, width: bw, height: H - m.t - m.b + 20, fill: "transparent", tabindex: 0 });
      const tip = (e) => {
        bar.classList.add("hover");
        showTip(e, [pct(s.winRate), `Dealer shows ${upLabel(u)} · ${s.n} hands`, `${s.wins} W · ${s.losses} L · ${s.pushes} P`, `Net ${money(s.net)}`]);
      };
      hit.addEventListener("pointermove", tip);
      hit.addEventListener("focus", () => {
        const r = hit.getBoundingClientRect();
        tip({ clientX: r.left + r.width / 2, clientY: r.top + 20 });
      });
      const off = () => {
        bar.classList.remove("hover");
        hideTip();
      };
      hit.addEventListener("pointerleave", off);
      hit.addEventListener("blur", off);
      root.append(bar, val, hit);
    });
    els.upChart.replaceChildren(root);

    table(
      els.upTable,
      ["Dealer shows", "Hands", "Win rate", "Net", "Per hand"],
      ups
        .filter((u) => groups.has(u))
        .map((u) => {
          const s = summarize(groups.get(u));
          return [upLabel(u), s.n, pct(s.winRate), signed(s.net), signed(s.perHand, per(s.perHand))];
        })
    );
  }

  function roundedTop(x, y, w, h, r) {
    r = Math.min(r, h, w / 2);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  function renderDecisions(list) {
    const decided = list.filter((h) => h.decisions > 0);
    const followed = decided.filter((h) => h.basic_strategy_deviations === 0);
    const deviated = decided.filter((h) => h.basic_strategy_deviations > 0);
    const row = (name, l) => {
      const s = summarize(l);
      return [name, s.n, pct(s.winRate), signed(s.net), signed(s.perHand, per(s.perHand))];
    };
    table(els.adherence, ["Hands where you…", "Hands", "Win rate", "Net", "Per hand"], decided.length ? [row("Followed basic strategy", followed), row("Deviated at least once", deviated)] : []);

    const devs = list.flatMap((h) => h.actions.filter((a) => a.matches_basic === false).map((a) => ({ a, h })));
    const groups = [...groupBy(devs, ({ a }) => `${handLabel(a.player_total, a.player_soft)}|${a.dealer_upcard_value}|${a.action}|${a.recommended_action}`)]
      .sort((x, y) => y[1].length - x[1].length)
      .slice(0, 8);
    table(
      els.deviations,
      ["Situation", "You", "Chart", "Times", "Net"],
      groups.map(([k, v]) => {
        const [hand, up, act, rec] = k.split("|");
        const net = v.reduce((t, { h }) => t + h.net, 0);
        return [`${hand} vs ${upLabel(+up)}`, ACTION[act], ACTION[rec], v.length, signed(net)];
      }),
      "No deviations. Every decision matched basic strategy."
    );
  }

  function renderStarts(list) {
    const groups = groupBy(list, startBucket);
    table(
      els.start,
      ["Starting hand", "Hands", "Win rate", "Net", "Per hand"],
      BUCKET_ORDER.filter((b) => groups.has(b)).map((b) => {
        const s = summarize(groups.get(b));
        return [b, s.n, pct(s.winRate), signed(s.net), signed(s.perHand, per(s.perHand))];
      })
    );
  }

  function renderStrategies() {
    // Uses the period filter but ignores the strategy filter so strategies can be compared.
    const days = els.range.value;
    const since = days === "all" ? 0 : Date.now() - Number(days) * 864e5;
    const inRange = hands.filter((h) => new Date(h.played_at).getTime() >= since);
    const groups = groupBy(inRange, (h) => h.strategy_id || "none");
    const rows = [...groups]
      .map(([k, v]) => [k === "none" ? "No strategy" : strategyName(k), summarize(v)])
      .sort((a, b) => b[1].n - a[1].n)
      .map(([name, s]) => [name, s.n, pct(s.winRate), signed(s.net), signed(s.perHand, per(s.perHand)), pct(s.roi), pct(s.accuracy)]);
    table(els.strategies, ["Strategy", "Hands", "Win rate", "Net", "Per hand", "Return", "Chart match"], rows);
  }

  function renderRecent(list) {
    const recent = list.slice(-20).reverse();
    table(
      els.recent,
      ["When", "You", "Dealer", "Moves", "Bet", "Result"],
      recent.map((h) => [
        new Date(h.played_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
        `${h.player_cards.map(cardText).join(" ")} (${h.player_final_total})`,
        `${h.dealer_cards.map(cardText).join(" ")} (${h.dealer_final_total})`,
        h.actions.map((a) => `${ACTION[a.action]}${a.matches_basic === false ? "*" : ""}`).join(", ") || "—",
        plain$(h.final_bet),
        signed(h.net, `${OUTCOME[h.outcome]} ${money(h.net)}`),
      ])
    );
    const note = els.recent.parentElement.nextElementSibling;
    if (!note || !note.classList?.contains("table-note")) {
      els.recent.parentElement.after(el("p", { class: "hint table-note" }, "* = differed from basic strategy"));
    }
  }

  // ---------- CSV export ----------

  function csv(rows) {
    const esc = (v) => {
      if (v == null) return "";
      const s = Array.isArray(v) ? v.join(" ") : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return rows.map((r) => r.map(esc).join(",")).join("\n");
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const a = el("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $("export-hands").addEventListener("click", () => {
    const cols = [
      "id", "played_at", "strategy", "bank_before", "bet", "final_bet", "doubled", "player_cards", "dealer_cards",
      "dealer_upcard_value", "player_start_total", "player_start_soft", "player_start_pair", "player_final_total",
      "dealer_final_total", "player_blackjack", "dealer_blackjack", "player_bust", "dealer_bust", "outcome", "net",
      "bank_after", "decisions", "basic_strategy_deviations", "cards_remaining", "deck_count",
    ];
    const rows = filtered().map((h) => cols.map((c) => (c === "strategy" ? (h.strategy_id ? strategyName(h.strategy_id) : "") : h[c])));
    download("blackjack-hands.csv", csv([cols, ...rows]));
  });

  $("export-decisions").addEventListener("click", () => {
    const cols = [
      "hand_id", "played_at", "strategy", "seq", "player_total", "player_soft", "card_count", "dealer_upcard_value",
      "action", "recommended_action", "matches_basic", "card_drawn", "total_after", "bet", "final_bet", "outcome", "net",
    ];
    const rows = filtered().flatMap((h) =>
      h.actions.map((a) => [
        h.id, h.played_at, h.strategy_id ? strategyName(h.strategy_id) : "", a.seq, a.player_total, a.player_soft,
        a.card_count, a.dealer_upcard_value, a.action, a.recommended_action, a.matches_basic, a.card_drawn,
        a.total_after, h.bet, h.final_bet, h.outcome, h.net,
      ])
    );
    download("blackjack-decisions.csv", csv([cols, ...rows]));
  });

  // ---------- Wiring ----------

  els.strategy.addEventListener("change", render);
  els.range.addEventListener("change", render);

  document.addEventListener("bj:user", (e) => {
    user = e.detail.user;
    hands = [];
    loaded = false;
    stale = true;
    els.body.hidden = true;
    els.status.hidden = false;
    els.status.textContent = "Loading your stats…";
    if (user && visible) load();
  });

  document.addEventListener("bj:tab", (e) => {
    visible = e.detail.tab === "stats";
    hideTip();
    if (visible && stale) load();
  });

  Tracker.onChange(() => {
    stale = true;
    if (visible) load();
    else if (loaded) renderStrategyFilter();
  });
})();
