
(function(){
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const CONFIG = window.APP_CONFIG;

  const store = {
    get(k, def){ try{ return JSON.parse(localStorage.getItem(k)) ?? def; }catch(e){ return def; } },
    set(k, v){ localStorage.setItem(k, JSON.stringify(v)); },
    del(k){ localStorage.removeItem(k); }
  };

  const K = { USER:"user", BAL:"balance", TASKS:"tasks", HISTORY:"withdraw_history" };
  const todayStr = () => new Date().toISOString().slice(0,10);

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
    } catch(e){}
    if(!user){ user = { id:"guest", first_name:"Guest", last_name:"", username:"", photo_url:"" }; store.set(K.USER,user); }
    return user;
  }

  function initTasks(){
    const t = store.get(K.TASKS, {date: todayStr(), done: 0});
    if(t.date !== todayStr()){ t.date = todayStr(); t.done = 0; store.set(K.TASKS, t); }
    return t;
  }

  function formatUSD(n){ return (Math.round(n*100)/100).toFixed(2); }

  let USER = initUser();
  let TASKS = initTasks();
  let BAL = parseFloat(store.get(K.BAL, 0));

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

    const refBase = "https://t.me/facebook_farmers_bot?start="; 
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

    const hist = store.get(K.HISTORY, []);
    const wrap = $("#history");
    if(wrap){
      wrap.innerHTML = "";
      hist.forEach(item => {
        const div = document.createElement("div");
        div.className = "history-item";
        div.innerHTML = `<b>${item.method}</b> • $${item.amount} • ${item.address}<br><span class="muted small">${item.time} • ${item.status}</span>`;
        wrap.appendChild(div);
      });
    }
  }

  async function doAdAndReward(buttonEl, statusEl){
    const completed = TASKS.done;
    if(completed >= CONFIG.TASKS_PER_DAY){ statusEl.textContent = "Daily limit reached."; return; }
    statusEl.textContent = "Loading ad...";
    buttonEl.disabled = true;
    try{
      if(typeof window.show_9722437 === "function"){
        const maybePromise = window.show_9722437('pop');
        if(maybePromise && typeof maybePromise.then === "function"){ await maybePromise; }
        else { await new Promise(res => setTimeout(res, 3000)); }
      }else{
        await new Promise(res => setTimeout(res, 2500));
      }
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

  async function submitWithdraw(e){
    e.preventDefault();
    const method = document.getElementById("method").value;
    const address = document.getElementById("address").value.trim();
    const amount = parseFloat(document.getElementById("amount").value);
    const msgEl = document.getElementById("withdrawMsg");
    msgEl.textContent = "";

    if(isNaN(amount) || amount < CONFIG.MIN_WITHDRAW){ msgEl.textContent = `Minimum withdrawal is $${CONFIG.MIN_WITHDRAW.toFixed(2)}.`; return; }
    if(amount > BAL){ msgEl.textContent = "Insufficient balance."; return; }
    if(!address){ msgEl.textContent = "Enter a valid address/account."; return; }

    const text = `💸 Withdraw Request
User: ${USER.first_name || "Guest"} (${USER.username ? "@"+USER.username : "no username"})
TG ID: ${USER.id}
Method: ${method}
Address: ${address}
Amount: $${amount.toFixed(2)}
Balance Before: $${formatUSD(BAL)}
Time: ${new Date().toLocaleString()}`;

    const url = `https://api.telegram.org/bot${APP_CONFIG.BOT_TOKEN}/sendMessage`;
  }

  // Fix BOT token scope bug (use CONFIG)
  const APP_CONFIG = window.APP_CONFIG;

  function sendToAdmin(text){
    const url = `https://api.telegram.org/bot${APP_CONFIG.BOT_TOKEN}/sendMessage`;
    const payload = { chat_id: APP_CONFIG.ADMIN_ID, text };
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      mode: "no-cors"
    }).catch(()=>{});
  }

  async function submitWithdrawWrapper(e){
    e.preventDefault();
    const method = document.getElementById("method").value;
    const address = document.getElementById("address").value.trim();
    const amount = parseFloat(document.getElementById("amount").value);
    const msgEl = document.getElementById("withdrawMsg");
    msgEl.textContent = "";

    if(isNaN(amount) || amount < APP_CONFIG.MIN_WITHDRAW){ msgEl.textContent = `Minimum withdrawal is $${APP_CONFIG.MIN_WITHDRAW.toFixed(2)}.`; return; }
    if(amount > BAL){ msgEl.textContent = "Insufficient balance."; return; }
    if(!address){ msgEl.textContent = "Enter a valid address/account."; return; }

    const text =
`💸 Withdraw Request
User: ${USER.first_name || "Guest"} (${USER.username ? "@"+USER.username : "no username"})
TG ID: ${USER.id}
Method: ${method}
Address: ${address}
Amount: $${amount.toFixed(2)}
Balance Before: $${formatUSD(BAL)}
Time: ${new Date().toLocaleString()}`;

    await sendToAdmin(text);

    BAL = Math.max(0, BAL - amount);
    store.set(K.BAL, BAL);
    const hist = store.get(K.HISTORY, []);
    hist.unshift({ method, address, amount: amount.toFixed(2), time: new Date().toLocaleString(), status: "pending" });
    store.set(K.HISTORY, hist);

    msgEl.textContent = "Request sent to admin. You'll be paid soon.";
    document.getElementById("withdrawForm").reset();
    refreshUI();
  }

  function switchTab(tab){
    $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    $$(".page").forEach(p => p.classList.remove("active"));
    document.getElementById("page-" + tab).classList.add("active");
  }

  document.getElementById("copyRef").addEventListener("click", () => {
    const el = document.getElementById("refLink");
    el.select();
    document.execCommand("copy");
    document.getElementById("copyRef").textContent = "Copied";
    setTimeout(() => document.getElementById("copyRef").textContent = "Copy", 1200);
  });

  document.getElementById("startEarningBtn").addEventListener("click", () => doAdAndReward(document.getElementById("startEarningBtn"), document.getElementById("limitMsg")));
  document.getElementById("earnNow").addEventListener("click", () => doAdAndReward(document.getElementById("earnNow"), document.getElementById("earnStatus")));
  document.getElementById("withdrawForm").addEventListener("submit", submitWithdrawWrapper);

  $$(".tab").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

  refreshUI();
  try{ if(window.Telegram && Telegram.WebApp) { Telegram.WebApp.expand(); }}catch(e){}
})();
