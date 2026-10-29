const $ = id => document.getElementById(id);
let adminName = "", forms = [], cur = null, fields = [], logo = "", rmLogo = false,
    editIdx = -1, saving = false, resp = [], rf = null;
async function call(a, d = {}) {
  try { return await api(a, { admin: true, ...d }); }
  catch (e) { if (e.message === "Session expired") { toast("Session expired. Please sign in again.", "err"); showLogin(); } throw e; }
}
const NOFILE = t => t !== "photo" && t !== "signature";
let banner = "", rmBannerFlag = false;
const CHOICE = t => ["dropdown", "radio", "checkbox"].includes(t);
const safeUrl = u => /^https:\/\/(drive|docs)\.google\.com\//.test(u) ? u : "";
const fid = () => "f_" + [...crypto.getRandomValues(new Uint8Array(8))].map(b => (b % 36).toString(36)).join("");

function view(n) { ["dash", "builder", "resp"].forEach(p => $(p).classList.toggle("hidden", p !== n)); scrollTo(0, 0); }
function gate(ok) { $("loginPage").classList.toggle("hidden", ok); $("app").classList.toggle("hidden", !ok); }
function busy(b) { saving = b; $("btnDraft").disabled = $("btnPub").disabled = b; }

/* ---------- auth: email + password. OTP only once at sign up (verify email) and for password reset. Google also supported ---------- */
let mode = "login", pendingEmail = "", otpType = "signup", tick = null;
const step = n => { ["Email", "Code", "Reset"].forEach(s => $("step" + s).classList.toggle("hidden", n !== s.toLowerCase())); if (n === "code") buildOtp(); };
function setMode(m) {
  mode = m; const su = m === "signup";
  $("tLogin").classList.toggle("on", !su); $("tSignup").classList.toggle("on", su);
  $("nameWrap").classList.toggle("hidden", !su); $("pass2Wrap").classList.toggle("hidden", !su); $("forgotWrap").classList.toggle("hidden", su); $("termsWrap").classList.toggle("hidden", !su);
  $("aPass").autocomplete = su ? "new-password" : "current-password";
  $("aTitle").textContent = su ? "Create your account" : "Welcome back";
  $("aSub").textContent = su ? "Sign up to start building forms" : "Log in to your dashboard";
  $("aSend").textContent = su ? "Create account" : "Log in";
}
const userName = u => (u && u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || "";
function showLogin() { gate(false); step("email"); setMode("login"); }
$("tLogin").onclick = () => setMode("login"); $("tSignup").onclick = () => setMode("signup");
$("aBack").onclick = () => { clearInterval(tick); step("email"); };
$("gbtn").onclick = () => !SB ? toast("Preview only: Google login needs Supabase", "err") : SB.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });

const otp = () => $("otp"), code = () => [...otp().children].map(i => i.value).join("");
function buildOtp() {
  otp().innerHTML = "";
  for (let i = 0; i < 6; i++) { const e = document.createElement("input"); e.inputMode = "numeric"; e.maxLength = 6; e.autocomplete = i ? "off" : "one-time-code"; e.setAttribute("aria-label", "Digit " + (i + 1)); otp().appendChild(e); }
  otp().firstChild.focus();
}
function fill(t, start) {
  [...t].slice(0, 6 - start).forEach((c, k) => otp().children[start + k].value = c);
  otp().children[Math.min(start + t.length, 5)].focus(); if (code().length === 6) verify();
}
const idx = e => [...otp().children].indexOf(e.target);
otp().addEventListener("input", e => { const v = e.target.value.replace(/\D/g, ""); e.target.value = ""; if (v) fill(v, idx(e)); });
otp().addEventListener("paste", e => { e.preventDefault(); fill((e.clipboardData.getData("text") || "").replace(/\D/g, ""), idx(e)); });
otp().addEventListener("keydown", e => { if (e.key === "Backspace" && !e.target.value && idx(e) > 0) otp().children[idx(e) - 1].focus(); });

function startTimer() {
  let n = 30; $("aResend").classList.add("hidden"); clearInterval(tick);
  tick = setInterval(() => { n--; $("aTimer").textContent = n > 0 ? "Resend in " + n + "s" : ""; if (n <= 0) { clearInterval(tick); $("aResend").classList.remove("hidden"); } }, 1000);
  $("aTimer").textContent = "Resend in 30s";
}
const toCode = (email, type) => { pendingEmail = email; otpType = type; $("aSent").textContent = email; step("code"); startTimer(); };
const authErr = m => /invalid login|invalid credentials/i.test(m) ? "Wrong email or password." : /rate limit|too many/i.test(m) ? "Too many attempts. Please wait a minute and try again." : m;

async function submitAuth() {
  const email = $("aEmail").value.trim().toLowerCase(), name = $("aName").value.trim(), pass = $("aPass").value;
  if (pass.length < 8) return toast("Password must be at least 8 characters", "err");
  if (mode === "signup") {
    if (!name) return toast("Enter your full name", "err");
    if (pass !== $("aPass2").value) return toast("Passwords do not match", "err");
  }
  if (!SB) { if (mode === "signup") { toCode(email, "signup"); return toast("Preview: enter any 6 digits", "ok"); } return enter(email, ""); }
  $("aSend").disabled = true;
  try {
    if (mode === "signup") {
      const { data, error } = await SB.auth.signUp({ email, password: pass, options: { data: { full_name: name } } });
      if (error) return toast(authErr(error.message), "err");
      if (data.user && data.user.identities && !data.user.identities.length) return toast("This email is already registered. Please log in.", "err");
      if (data.session) return boot();                   // email confirmation turned off in Supabase
      toCode(email, "signup");
    } else {
      const { error } = await SB.auth.signInWithPassword({ email, password: pass });
      if (error) {
        if (/not confirmed/i.test(error.message)) {       // signed up earlier but never verified: send a new code
          await SB.auth.resend({ type: "signup", email }); toast("Please verify your email first. We sent a new code.", "ok"); return toCode(email, "signup");
        }
        return toast(authErr(error.message), "err");
      }
      boot();
    }
  } finally { $("aSend").disabled = false; }
}
$("emailForm").onsubmit = e => { e.preventDefault(); submitAuth(); };

$("aForgot").onclick = async () => {
  const email = $("aEmail").value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast("Enter your email first", "err");
  if (!SB) { toCode(email, "recovery"); return toast("Preview: enter any 6 digits", "ok"); }
  const { error } = await SB.auth.resetPasswordForEmail(email);
  if (error) return toast(authErr(error.message), "err");
  toCode(email, "recovery");
};
$("aResend").onclick = async () => {
  if (!SB) return startTimer();
  const { error } = otpType === "signup" ? await SB.auth.resend({ type: "signup", email: pendingEmail }) : await SB.auth.resetPasswordForEmail(pendingEmail);
  if (error) return toast(authErr(error.message), "err"); toast("New code sent", "ok"); startTimer();
};
async function verify() {
  const token = code(); if (token.length < 6) return toast("Enter the 6-digit code", "err");
  if (!SB) { clearInterval(tick); return otpType === "recovery" ? step("reset") : enter(pendingEmail, ""); }
  $("aVerify").disabled = true;
  const { error } = await SB.auth.verifyOtp({ email: pendingEmail, token, type: otpType });
  $("aVerify").disabled = false;
  if (error) { toast(/expired|invalid/i.test(error.message) ? "Invalid or expired code. Please try again." : error.message, "err"); buildOtp(); return; }
  clearInterval(tick);
  if (otpType === "recovery") { step("reset"); $("rPass").focus(); } else boot();
}
$("aVerify").onclick = verify;
$("resetForm").onsubmit = async e => {
  e.preventDefault(); const p = $("rPass").value;
  if (p.length < 8) return toast("Password must be at least 8 characters", "err");
  if (p !== $("rPass2").value) return toast("Passwords do not match", "err");
  if (!SB) return enter(pendingEmail, "");
  $("rSave").disabled = true;
  const { error } = await SB.auth.updateUser({ password: p });
  $("rSave").disabled = false;
  if (error) return toast(error.message, "err");
  toast("Password updated", "ok"); boot();
};

function enter(email, name) { adminName = name || ""; $("me").textContent = name || email || ""; gate(true); refresh(); }
async function boot() {
  let c; try { c = await api("config"); } catch (e) { return toast(e.message, "err"); }
  if (!c.auth && new URLSearchParams(location.search).has("login")) return showLogin();   // preview the login screen in demo mode: index.html?login
  if (!c.auth) { $("logout").classList.add("hidden"); $("demoBar").classList.remove("hidden"); gate(true); return refresh(); }
  const { data: { session } } = await SB.auth.getSession();
  if (!session) return showLogin();
  try { await call("auth"); enter(session.user.email, userName(session.user)); }
  catch (e) { if (e.message !== "Session expired") { toast(e.message, "err"); showLogin(); } }
}
$("logout").onclick = async () => { if (SB) await SB.auth.signOut(); showLogin(); };

/* ---------- dashboard ---------- */
async function refresh() {
  view("dash");
  try { forms = (await call("getForms")).forms; } catch (e) { toast(e.message, "err"); }
  renderForms();
}
const link = id => location.origin + location.pathname.replace(/[^/]*$/, "") + "form.html?id=" + id;
const FILE_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>';
function renderForms() {
  const pub = forms.filter(f => f.status === "published").length, total = forms.reduce((n, f) => n + (f.response_count || 0), 0);
  $("sTotal").textContent = forms.length; $("sPub").textContent = pub; $("sDraft").textContent = forms.length - pub; $("sResp").textContent = total;
  $("heroName").textContent = adminName ? adminName.split(" ")[0] : "Admin";
  $("avatar").textContent = ((adminName || $("me").textContent || "A")[0] || "A").toUpperCase();
  $("heroDate").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  $("formsList").innerHTML = forms.length ? forms.map((f, i) => {
    const n = f.response_count || 0, pct = total ? Math.round(n / total * 100) : 0, on = f.status === "published";
    return `<div class="fcard c${i % 4}">
      <div class="fc-main"><div class="ico">${FILE_ICON}</div><div class="grow">
        <div class="fc-title"><h3>${esc(f.form_title)}</h3><span class="pillb ${on ? "ok" : ""}">${on ? "Published" : "Draft"}</span></div>
        <p class="muted">${esc(f.company_name)}</p><p class="muted fc-meta">${f.fields.length} fields · Updated ${esc(f.updated_at ? new Date(f.updated_at).toLocaleDateString() : "-")}</p></div></div>
      <div class="fc-stat"><div class="fc-num"><strong>${n}</strong><span>Responses</span></div>
        <div class="prog"><span>Share of all responses</span><b>${pct}%</b></div><div class="track"><i style="width:${pct}%"></i></div></div>
      <div class="fc-actions">
        <button class="btn sm c" onclick="showResp('${f.id}')">Responses</button>
        <button class="btn sm" onclick="openBuilder('${f.id}')">Edit</button>
        ${on ? `<button class="btn sm" onclick="window.open('${link(f.id)}','_blank')">Open</button><button class="btn sm" onclick="copyLink('${f.id}')">Copy link</button>` : ""}
        <button class="btn sm danger" onclick="delForm('${f.id}')">Delete</button></div></div>`;
  }).join("") : '<div class="fempty" style="grid-column:1/-1">No forms yet. Click “+ New form” to create your first one.</div>';
}
const copyLink = id => navigator.clipboard.writeText(link(id)).then(() => toast("Link copied"));
async function delForm(id) {
  if (!confirm("Delete this form together with all its responses and files? This cannot be undone.")) return;
  try { await call("deleteForm", { form_id: id }); toast("Form deleted"); refresh(); } catch (e) { toast(e.message, "err"); }
}

/* ---------- builder ---------- */
const V = { companyName: "company_name", formTitle: "form_title", address: "address", phone: "phone", email: "email", website: "website", footerText: "footer_text", formDesc: "description" };
async function openBuilder(id) {
  cur = null; fields = []; logo = ""; rmLogo = false; $("logoFile").value = ""; banner = ""; rmBannerFlag = false; $("bannerFile").value = ""; $("surveyMode").checked = false; $("thanksMsg").value = "";
  Object.keys(V).forEach(k => $(k).value = "");
  let f = null;
  if (id) { try { f = (await call("getForm", { id })).form; } catch (e) { return toast(e.message, "err"); } }
  if (f) { cur = f.id; Object.entries(V).forEach(([k, v]) => $(k).value = f[v] || ""); fields = f.fields || []; setLogo(f.logo); setBanner(f.banner); $("surveyMode").checked = !!(f.settings || {}).survey; $("thanksMsg").value = (f.settings || {}).thanks || ""; }
  else { setLogo(""); setBanner(""); }
  $("bTitle").textContent = f ? "Edit form" : "New form";
  renderFields(); view("builder");
}
function setLogo(src) {
  $("logoPreview").src = src || ""; $("logoPreview").classList.toggle("hidden", !src); $("rmLogo").classList.toggle("hidden", !src);
}
$("logoFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  if (!f.type.startsWith("image/") || f.size > 5 * 1024 * 1024) { e.target.value = ""; return toast("Choose an image under 5 MB", "err"); }
  try { logo = await resizeImage(f, 500, "image/png"); rmLogo = false; setLogo(logo); } catch (x) { toast(x.message, "err"); }
};
function setBanner(src) {
  $("bannerPreview").src = src || ""; $("bannerPreview").classList.toggle("hidden", !src); $("rmBanner").classList.toggle("hidden", !src);
}
$("bannerFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  if (!f.type.startsWith("image/") || f.size > 8 * 1024 * 1024) { e.target.value = ""; return toast("Choose an image under 8 MB", "err"); }
  try { banner = await bannerImage(f); rmBannerFlag = false; setBanner(banner); } catch (x) { e.target.value = ""; toast(x.message, "err"); }
};
$("rmBanner").onclick = () => { banner = ""; rmBannerFlag = true; $("bannerFile").value = ""; setBanner(""); };
$("rmLogo").onclick = () => { logo = ""; rmLogo = true; $("logoFile").value = ""; setLogo(""); };

function renderFields() {
  $("fieldsList").innerHTML = fields.length ? fields.map((f, i) => `
    <div class="item"><div class="grow"><b>${esc(f.label)}</b> ${f.required ? '<span class="badge">Required</span>' : ""}
      <div class="muted">${esc(f.type === "scale" ? "scale 1–" + (f.max || 5) : f.type)}${f.options && f.options.length ? " · " + f.options.length + " options" : ""}${f.help ? " · has help text" : ""}</div></div>
      <div class="row"><button class="btn sm" ${i ? "" : "disabled"} onclick="move(${i},-1)">↑</button>
      <button class="btn sm" ${i < fields.length - 1 ? "" : "disabled"} onclick="move(${i},1)">↓</button>
      <button class="btn sm" onclick="openField(${i})">Edit</button>
      <button class="btn sm danger" onclick="delField(${i})">Delete</button></div></div>`).join("")
    : '<div class="empty">No fields yet.</div>';
}
function move(i, d) { [fields[i], fields[i + d]] = [fields[i + d], fields[i]]; renderFields(); }
function delField(i) { if (confirm("Delete this field?")) { fields.splice(i, 1); renderFields(); } }
function typeChanged() {
  const t = $("fType").value; $("fOptsWrap").classList.toggle("hidden", !CHOICE(t));
  $("fScaleWrap").classList.toggle("hidden", t !== "scale"); $("fSigHint").classList.toggle("hidden", t !== "signature"); $("fReqWrap").classList.toggle("hidden", t === "signature");
}
function openField(i = -1) {
  editIdx = i; const f = i >= 0 ? fields[i] : { label: "", type: "text", options: [], required: false };
  $("fmTitle").textContent = i >= 0 ? "Edit field" : "Add field";
  $("fLabel").value = f.label; $("fType").value = f.type; $("fOpts").value = (f.options || []).join("\n"); $("fReq").checked = f.required; $("fHelp").value = f.help || ""; $("fMax").value = f.max || 5; $("fLo").value = f.lo || ""; $("fHi").value = f.hi || "";
  typeChanged(); $("fm").classList.remove("hidden"); $("fLabel").focus();
}
function closeField() { $("fm").classList.add("hidden"); }
function saveField() {
  const label = $("fLabel").value.trim(), type = $("fType").value;
  const options = CHOICE(type) ? $("fOpts").value.split("\n").map(s => s.trim()).filter(Boolean) : [];
  if (!label) return toast("Enter a field label", "err");
  if (CHOICE(type) && !options.length) return toast("Add at least one option", "err");
  const f = { id: editIdx >= 0 ? fields[editIdx].id : fid(), label, type, options, required: type !== "signature" && $("fReq").checked };
  const help = $("fHelp").value.trim(); if (help) f.help = help;
  if (type === "scale") { f.max = +$("fMax").value; const lo = $("fLo").value.trim(), hi = $("fHi").value.trim(); if (lo) f.lo = lo; if (hi) f.hi = hi; }
  if (editIdx >= 0) fields[editIdx] = f; else fields.push(f);
  renderFields(); closeField();
}
async function saveForm(status) {
  if (saving) return;
  const form = { id: cur, status, fields, logo_data: logo || undefined, remove_logo: rmLogo, banner_data: banner || undefined, remove_banner: rmBannerFlag,
    settings: { survey: $("surveyMode").checked, thanks: $("thanksMsg").value.trim() } };
  Object.entries(V).forEach(([k, v]) => form[v] = $(k).value.trim());
  if (!form.company_name || !form.form_title) return toast("Company name and form title are required", "err");
  if (!fields.length) return toast("Add at least one field", "err");
  busy(true);
  try { await call("saveForm", { form }); toast(status === "published" ? "Form published" : "Draft saved"); await refresh(); }
  catch (e) { toast(e.message, "err"); } finally { busy(false); }
}

/* ---------- responses ---------- */
async function showResp(id) {
  rf = forms.find(f => f.id === id); resp = [];
  $("rTitle").textContent = rf.form_title; $("rSearch").value = $("rFrom").value = $("rTo").value = ""; view("resp");
  $("rBody").innerHTML = '<tr><td class="empty" colspan="9">Loading…</td></tr>';
  try { resp = (await call("getResponses", { form_id: id })).responses; } catch (e) { toast(e.message, "err"); }
  renderResp();
}
const when = v => v ? new Date(v).toLocaleString() : "-";
function filtered() {
  const q = $("rSearch").value.toLowerCase(), f = $("rFrom").value, t = $("rTo").value;
  const from = f ? new Date(f + "T00:00:00") : null, to = t ? new Date(t + "T23:59:59.999") : null;
  return resp.map((r, i) => [r, i]).filter(([r]) => {
    const d = new Date(r.submitted_at);
    return (!q || JSON.stringify(r).toLowerCase().includes(q)) && (!from || d >= from) && (!to || d <= to);
  });
}
function clearFilters() { $("rSearch").value = $("rFrom").value = $("rTo").value = ""; renderResp(); }
function summary(rows) {
  if (!rows.length) return "";
  const bars = (m, ord) => { const e = ord ? Object.entries(m) : Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8), mx = Math.max(1, ...e.map(x => x[1]));
    return e.map(([k, n]) => `<div class="bar"><span title="${esc(k)}">${esc(k)}</span><i><b style="width:${Math.round(n / mx * 100)}%"></b></i><em>${n}</em></div>`).join(""); };
  const days = {}; rows.forEach(([r]) => { const k = new Date(r.submitted_at).toLocaleDateString(); days[k] = (days[k] || 0) + 1; });
  const dates = rows.map(([r]) => new Date(r.submitted_at)), last = new Date(Math.max(...dates)), first = new Date(Math.min(...dates));
  let out = `<div class="card"><h3>Overview</h3><div class="muted">Total: <b>${rows.length}</b><br>First: ${esc(first.toLocaleString())}<br>Latest: ${esc(last.toLocaleString())}</div></div>
    <div class="card"><h3>Responses per day</h3>${bars(days)}</div>`;
  rf.fields.filter(f => CHOICE(f.type)).forEach(f => {
    const m = {}; rows.forEach(([r]) => String(r[f.id] || "").split(", ").filter(Boolean).forEach(v => m[v] = (m[v] || 0) + 1));
    if (Object.keys(m).length) out += `<div class="card"><h3>${esc(f.label)}</h3>${bars(m)}</div>`;
  });
  rf.fields.filter(f => f.type === "scale").forEach(f => {
    const max = f.max || 5, m = {}; for (let i = 1; i <= max; i++) m[i] = 0;
    let n = 0, t = 0; rows.forEach(([r]) => { const v = parseInt(r[f.id], 10); if (v >= 1 && v <= max) { m[v]++; n++; t += v; } });
    if (n) out += `<div class="card"><h3>${esc(f.label)}</h3><p class="muted">Average ${(t / n).toFixed(2)} / ${max} · ${n} answers</p>${bars(m, true)}</div>`;
  });
  return '<div class="sum">' + out + "</div>";
}
function renderResp() {
  const cols = rf.fields.filter(f => NOFILE(f.type)).slice(0, 4), rows = filtered();
  $("rCount").textContent = rows.length + " of " + resp.length + " responses";
  $("rSummary").innerHTML = summary(rows);
  $("rHead").innerHTML = "<tr><th>Submitted</th>" + cols.map(c => `<th>${esc(c.label)}</th>`).join("") + "<th></th></tr>";
  $("rBody").innerHTML = rows.length ? rows.map(([r, i]) => `<tr class="click" onclick="showDetail(${i})"><td>${esc(when(r.submitted_at))}</td>` +
    cols.map(c => `<td>${esc(r[c.id] || "-")}</td>`).join("") + '<td><button class="btn sm">View</button></td></tr>').join("")
    : `<tr><td class="empty" colspan="${cols.length + 2}">No responses found.</td></tr>`;
}
function showDetail(i) {
  const r = resp[i];
  $("dBody").innerHTML = '<div class="dl"><b>Submitted</b><span>' + esc(when(r.submitted_at)) + "</span>" +
    rf.fields.filter(f => NOFILE(f.type)).map(f => `<b>${esc(f.label)}</b><span>${esc(r[f.id] || "-")}</span>`).join("") +
    (r.pdf_path ? '<b>PDF</b><span><button class="btn sm" onclick="openPdf(' + i + ')">Open saved PDF</button></span>' : "") + "</div>";
  $("dm").classList.remove("hidden");
}
async function openPdf(i) {
  const { data, error } = await SB.storage.from("pdfs").createSignedUrl(resp[i].pdf_path, 120);
  if (error) return toast(error.message, "err");
  window.open(data.signedUrl, "_blank", "noopener");
}
async function exportPdf() {
  const list = filtered().map(([r]) => r); if (!list.length) return toast("No responses to export", "err");
  const b = $("btnExp"); b.disabled = true; b.textContent = "Preparing…";
  try {
    const f = (await call("getForm", { id: rf.id })).form, cols = rf.fields.filter(x => NOFILE(x.type)), land = cols.length > 4;
    const pdf = await htmlToPdf(n => {
      const logoImg = f.logo ? `<img class="paper-logo" src="${f.logo}" alt="">` : "";
      n.innerHTML = (f.logo ? `<img class="wm" src="${f.logo}" alt="">` : "") +
        `<div class="paper-header">${logoImg}<div class="grow"><h2>${esc(f.company_name)}</h2><h3>${esc(f.form_title)} · Responses (${list.length})</h3></div></div>
        <table class="rt"><thead><tr><th>#</th><th>Submitted</th>${cols.map(c => `<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>` +
        list.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(when(r.submitted_at))}</td>${cols.map(c => `<td>${esc(r[c.id] || "-")}</td>`).join("")}</tr>`).join("") +
        `</tbody></table><div class="paper-footer">${f.address ? `<div>${esc(f.address)}</div>` : ""}<div>Generated: ${esc(new Date().toLocaleString())}</div></div>`;
    }, f.logo, land);
    pdf.save(rf.form_title.replace(/[^a-z0-9]/gi, "_") + "_responses.pdf");
  } catch (e) { toast("PDF failed: " + e.message, "err"); } finally { b.disabled = false; b.textContent = "Download PDF"; }
}
function exportCsv() {
  const list = filtered().map(([r]) => r); if (!list.length) return toast("No responses to export", "err");
  const cols = rf.fields.filter(x => NOFILE(x.type)), cell = v => { v = String(v ?? ""); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
  const lines = [["Submitted", ...cols.map(c => c.label)].map(cell).join(",")].concat(list.map(r => [when(r.submitted_at), ...cols.map(c => r[c.id] || "")].map(cell).join(",")));
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  a.download = rf.form_title.replace(/[^a-z0-9]/gi, "_") + "_responses.csv"; a.click(); URL.revokeObjectURL(a.href);
}
$("yr").textContent = new Date().getFullYear();
boot();
