
(function(){
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const CONFIG = window.APP_CONFIG;

  // --- Simple persistent store using localStorage ---
  const store = {
    get(k, def){ try{ return JSON.parse(localStorage.getItem(k)) ?? def; }catch(e){ return def; } },
    set(k, v){ localStorage.setItem(k, JSON.stringify(v)); },
    del(k){ localStorage.removeItem(k); }
  };

  // Keys
  const K = {
    USER: "user",
    BAL: "balance",
    TASKS: "tasks",            // {date: 'YYYY-MM-DD', done: number}
    HISTORY: "withdraw_history"
  };

  const todayStr = () => new Date().toISOString().slice(0,10);

  // Initialize user from Telegram Web App
  function initUser(){
    let user = store.get(K.USER, null);
    try {
      if (window.Telegram && Telegram.WebApp && Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user) {
        const tg = Telegram.WebApp.initDataUnsafe.user;
        user = {
          id: tg.id,
          first_name: tg.first_name || "User",
          last_name: tg.last_name || "",
          username: tg.username || "",
          photo_url: tg.photo_url || ""
        };
        store.set(K.USER, user);
      }
    } catch(e){ /* ignore */ }
    if(!user){
      // Fallback guest profile
      user = { id: "guest", first_name: "Guest", last_name: "", username: "", photo_url: "" };
      store.set(K.USER, user);
    }
    return user;
  }

  function initTasks(){
    const t = store.get(K.TASKS, {date: todayStr(), done: 0});
    if(t.date !== todayStr()){
      t.date = todayStr();
      t.done = 0;
      store.set(K.TASKS, t);
    }
    return t;
  }

  function formatUSD(n){
    return (Math.round(n*100)/100).toFixed(2);
  }

  // State
  let USER = initUser();
  let TASKS = initTasks();
  let BAL = parseFloat(store.get(K.BAL, 0));

  // UI bind
  function refreshUI(){
    const completed = TASKS.done;
    const remaining = Math.max(0, CONFIG.TASKS_PER_DAY - completed);
    $("#totalTasks").textContent = CONFIG.TASKS_PER_DAY;
    $("#completedTasks").textContent = completed;
    $("#remainingTasks").textContent = remaining;
    $("#earnRemaining").textContent = remaining;
    $("#balanceValue").textContent = formatUSD(BAL);
    $("#pBalance").textContent = formatUSD(BAL);

    const fullName = [USER.first_name, USER.last_name].filter(Boolean).join(" ") || "Guest";
    $("#displayName").textContent = fullName;
    $("#pName").textContent = fullName;
    $("#pUsername").textContent = USER.username || "—";
    $("#pId").textContent = USER.id || "—";

    if(USER.photo_url){ $("#avatar").src = USER.photo_url; }

    const refBase = "https://t.me/facebook_farmers_bot?start="; // fallback generic
    $("#refLink").value = refBase + encodeURIComponent(USER.id || "guest");
    const limitMsg = $("#limitMsg");
    if(remaining === 0){
      limitMsg.textContent = "Daily limit reached. Come back tomorrow.";
      $("#startEarningBtn").disabled = true;
      $("#earnNow").disabled = true;
    }else{
      limitMsg.textContent = "";
      $("#startEarningBtn").disabled = false;
      $("#earnNow").disabled = false;
    }

    // Withdraw history
    const hist = store.get(K.HISTORY, []);
    const wrap = $("#history");
    wrap.innerHTML = "";
    hist.forEach(item => {
      const div = document.createElement("div");
      div.className = "history-item";
      div.innerHTML = `<b>${item.method}</b> • $${item.amount} • ${item.address}<br><span class="muted small">${item.time} • ${item.status}</span>`;
      wrap.appendChild(div);
    });
  }

  // Handle earning action
  async function doAdAndReward(buttonEl, statusEl){
    const completed = TASKS.done;
    if(completed >= CONFIG.TASKS_PER_DAY){
      statusEl.textContent = "Daily limit reached.";
      return;
    }
    // Try to show ad via provided SDK method if available
    statusEl.textContent = "Loading ad...";
    buttonEl.disabled = true;
    try{
      if(typeof window.show_9722437 === "function"){
        // Many networks return a promise; handle both promise & callback-free APIs
        const maybePromise = window.show_9722437('pop');
        if(maybePromise && typeof maybePromise.then === "function"){
          await maybePromise;
        }else{
          // Fallback: wait a short time to simulate ad completion
          await new Promise(res => setTimeout(res, 3000));
        }
      }else{
        // SDK not ready, fallback delay
        await new Promise(res => setTimeout(res, 2500));
      }
      // On "complete", credit reward
      TASKS.done += 1;
      BAL += CONFIG.REWARD_PER_TASK;
      store.set(K.TASKS, TASKS);
      store.set(K.BAL, BAL);
      statusEl.textContent = `+ $${CONFIG.REWARD_PER_TASK.toFixed(3)} added!`;
    }catch(e){
      statusEl.textContent = "Ad failed. Try again.";
    }finally{
      buttonEl.disabled = false;
      refreshUI();
    }
  }

  // Withdraw
  async function submitWithdraw(e){
    e.preventDefault();
    const method = $("#method").value;
    const address = $("#address").value.trim();
    const amount = parseFloat($("#amount").value);
    const msgEl = $("#withdrawMsg");
    msgEl.textContent = "";

    if(isNaN(amount) || amount < CONFIG.MIN_WITHDRAW){
      msgEl.textContent = `Minimum withdrawal is $${CONFIG.MIN_WITHDRAW.toFixed(2)}.`;
      return;
    }
    if(amount > BAL){
      msgEl.textContent = "Insufficient balance.";
      return;
    }
    if(!address){
      msgEl.textContent = "Enter a valid address/account.";
      return;
    }

    // Prepare message for admin
    const text =
`💸 Withdraw Request
User: ${USER.first_name || "Guest"} (${USER.username ? "@"+USER.username : "no username"})
TG ID: ${USER.id}
Method: ${method}
Address: ${address}
Amount: $${amount.toFixed(2)}
Balance Before: $${formatUSD(BAL)}
Time: ${new Date().toLocaleString()}`;

    const url = `https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendMessage`;
    const payload = { chat_id: CONFIG.ADMIN_ID, text };

    // Try to send to bot admin (CORS-safe best effort)
    try{
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        mode: "no-cors" // we can't read response but request will be sent
      });
    }catch(e){
      // ignore network errors; still record locally
    }

    // Deduct balance and save history
    BAL = Math.max(0, BAL - amount);
    store.set(K.BAL, BAL);
    const hist = store.get(K.HISTORY, []);
    hist.unshift({
      method, address, amount: amount.toFixed(2),
      time: new Date().toLocaleString(), status: "pending"
    });
    store.set(K.HISTORY, hist);

    msgEl.textContent = "Request sent to admin. You'll be paid soon.";
    $("#withdrawForm").reset();
    refreshUI();
  }

  // Navigation
  function switchTab(tab){
    $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    $$(".page").forEach(p => p.classList.remove("active"));
    $("#page-" + tab).classList.add("active");
  }

  // Events
  $("#copyRef").addEventListener("click", () => {
    $("#refLink").select();
    document.execCommand("copy");
    $("#copyRef").textContent = "Copied";
    setTimeout(() => $("#copyRef").textContent = "Copy", 1200);
  });

  $("#startEarningBtn").addEventListener("click", () => doAdAndReward($("#startEarningBtn"), $("#limitMsg")));
  $("#earnNow").addEventListener("click", () => doAdAndReward($("#earnNow"), $("#earnStatus")));
  $("#withdrawForm").addEventListener("submit", submitWithdraw);

  $$(".tab").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

  // First render
  refreshUI();

  // Auto-open Telegram mini app main button styling
  try{ if(window.Telegram && Telegram.WebApp) { Telegram.WebApp.expand(); }}catch(e){}

})();
