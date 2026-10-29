const $ = id => document.getElementById(id);
const el = (t, p = {}, ...c) => { const e = document.createElement(t); Object.assign(e, p); c.forEach(x => e.append(x)); return e; };
let F = null, files = {}, sending = false, lastPdf = null;
const FILE = t => t === "photo" || t === "signature";

document.addEventListener("DOMContentLoaded", async () => {
  const id = new URLSearchParams(location.search).get("id");
  if (!/^F[A-Za-z0-9]{9}$/.test(id || "")) return fail("Invalid form link.");
  try { F = (await api("getForm", { id }, true)).form; render(); } catch (e) { fail(e.message); }
});
const fail = m => { $("loading").textContent = m; };

function render() {
  $("loading").classList.add("hidden"); $("area").classList.remove("hidden");
  document.title = F.form_title + " | " + F.company_name;
  $("pubCompany").textContent = F.company_name; $("pubTitle").textContent = F.form_title;
  if (F.logo) {   // tab icon = this organization's logo
    document.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"]').forEach(l => l.remove());
    document.head.appendChild(Object.assign(document.createElement("link"), { rel: "icon", href: F.logo }));
  }
  if (F.logo) { $("pubLogo").src = F.logo; $("pubLogo").classList.remove("hidden"); }
  const st = F.settings || {};
  if (F.banner) { $("pubBanner").src = F.banner; $("pubBanner").classList.remove("hidden"); }
  if (F.description) { $("pubDesc").textContent = F.description; $("pubDesc").classList.remove("hidden"); }
  if (st.thanks) $("thanksText").textContent = st.thanks;
  if (st.survey) { $("btnPrev").classList.add("hidden"); $("btnDl2").classList.add("hidden"); }
  $("sfName").textContent = F.company_name; $("sfTag").textContent = F.footer_text || "";
  $("sfContact").innerHTML = [F.address, F.phone && "Phone: " + F.phone, F.email && "Email: " + F.email, F.website && "Web: " + F.website].filter(Boolean).map(esc).join("<br>");
  $("siteFoot").classList.remove("hidden");
  F.fields.filter(f => f.type !== "signature").forEach(f => $("fieldsBox").appendChild(createField(f)));
  $("dyn").onsubmit = submit; $("btnPrev").onclick = preview; $("btnDl").onclick = () => download();
}

function createField(f) {
  const w = el("div", { className: "dyn-field" + (["text", "number", "email", "date"].includes(f.type) ? "" : " full") });
  w.appendChild(el("label", { textContent: f.label + (f.required ? " *" : "") }));
  if (f.help) w.appendChild(el("div", { className: "help", textContent: f.help }));
  const base = { name: f.id };
  if (["text", "number", "email", "date"].includes(f.type)) w.appendChild(el("input", { ...base, type: f.type, required: f.required, maxLength: 500 }));
  else if (f.type === "scale") {
    const g = el("div", { className: "scale" });
    for (let i = 1; i <= (f.max || 5); i++) g.appendChild(el("label", { title: String(i) }, el("input", { ...base, type: "radio", value: String(i), required: f.required }), el("span", { textContent: String(i) })));
    w.appendChild(g);
    if (f.lo || f.hi) w.appendChild(el("div", { className: "scale-ends" }, el("span", { textContent: f.lo || "" }), el("span", { textContent: f.hi || "" })));
  }
  else if (f.type === "textarea") w.appendChild(el("textarea", { ...base, required: f.required, rows: 3, maxLength: 2000 }));
  else if (f.type === "dropdown") {
    const s = el("select", { ...base, required: f.required }, el("option", { value: "", textContent: "Select an option" }));
    f.options.forEach(o => s.appendChild(el("option", { value: o, textContent: o }))); w.appendChild(s);
  } else if (f.type === "radio" || f.type === "checkbox") {
    const g = el("div", { className: "choices" });
    f.options.forEach(o => g.appendChild(el("label", { className: "choice" },
      el("input", { ...base, type: f.type, value: o, required: f.type === "radio" && f.required }), " " + o)));
    w.appendChild(g);
  } else {
    const i = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp" });
    i.onchange = async () => {
      const file = i.files[0]; delete files[f.id]; if (!file) return;
      if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) { i.value = ""; return toast("Choose an image under 5 MB", "err"); }
      try { files[f.id] = await resizeImage(file, f.type === "photo" ? 700 : 600, "image/jpeg"); } catch (e) { i.value = ""; toast(e.message, "err"); }
    };
    w.appendChild(i);
  }
  return w;
}

function values() {
  const fd = new FormData($("dyn")), r = {};
  F.fields.forEach(f => { if (!FILE(f.type)) r[f.id] = f.type === "checkbox" ? fd.getAll(f.id) : (fd.get(f.id) || ""); });
  return r;
}
function validate() {
  const form = $("dyn"); if (!form.checkValidity()) { form.reportValidity(); return false; }
  const r = values();
  for (const f of F.fields) {
    if (!f.required) continue;
    if ((f.type === "checkbox" && !r[f.id].length) || (f.type === "photo" && !files[f.id])) { toast(f.label + " is required", "err"); return false; }
  }
  return true;
}

/* ---------- PDF paper (letterhead) ---------- */
/* Signatures stay BLANK (space + line + label) so the PDF can be printed and signed by hand.
   1 -> right | 2 -> left & right | 3 -> left, centre, right | more -> rows of 3 */
function sigRows(sigs) {
  let out = "";
  for (let i = 0; i < sigs.length; i += 3) {
    const g = sigs.slice(i, i + 3), pos = { 1: [3], 2: [1, 3], 3: [1, 2, 3] }[g.length];
    out += `<div class="sig-row">${g.map((s, k) => `<div class="sig-box" style="grid-column:${pos[k]}"><div class="sig-line">${esc(s.label)}</div></div>`).join("")}</div>`;
  }
  return out;
}
function buildPaper(target) {
  const r = values(), photoF = F.fields.find(f => f.type === "photo"), sigs = F.fields.filter(f => f.type === "signature");
  const rows = F.fields.filter(f => !FILE(f.type)).map(f => {
    const v = f.type === "checkbox" ? r[f.id].join(", ") : (f.type === "scale" && r[f.id] ? r[f.id] + " / " + (f.max || 5) : r[f.id]);
    return `<div class="pdf-row"><div class="pdf-label">${esc(f.label)}</div><div class="pdf-value">${esc(v || "-")}</div></div>`;
  }).join("");
  const contact = [F.phone && "Phone: " + F.phone, F.email && "Email: " + F.email, F.website && "Web: " + F.website].filter(Boolean).map(esc).join(" &nbsp;|&nbsp; ");
  target.innerHTML = `
    ${F.logo ? `<img class="wm" src="${F.logo}" alt="">` : ""}
    <div class="paper-header">${F.logo ? `<img class="paper-logo" src="${F.logo}" alt="">` : ""}
      <div class="grow"><h2>${esc(F.company_name)}</h2><h3>${esc(F.form_title)}</h3></div></div>
    <div class="paper-main"><div class="paper-body">${rows}</div>
      ${photoF && files[photoF.id] ? `<img class="paper-photo" src="${files[photoF.id]}" alt="">` : ""}</div>
    ${sigs.length ? `<div class="sigs">${sigRows(sigs)}</div>` : ""}
    <div class="paper-footer">${F.address ? `<div>${esc(F.address)}</div>` : ""}${contact ? `<div>${contact}</div>` : ""}${F.footer_text ? `<div>${esc(F.footer_text)}</div>` : ""}</div>`;
}
function preview() { if (!validate()) return; buildPaper($("paper")); $("pdfModal").classList.remove("hidden"); }
function closePdf() { $("pdfModal").classList.add("hidden"); }
const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

const makePdf = () => htmlToPdf(buildPaper, F.logo);
async function download(pdf) {
  try { pdf = pdf || await makePdf(); pdf.save(F.form_title.replace(/[^a-z0-9]/gi, "_") + ".pdf"); } catch (e) { toast("PDF failed: " + e.message, "err"); }
}

/* ---------- submit ---------- */
async function submit(e) {
  e.preventDefault(); if (sending || !validate()) return;
  sending = true; const b = $("btnSub"); b.disabled = true; b.textContent = "Submitting…";
  try {
    const pdf = await makePdf(); lastPdf = pdf;
    await api("submitResponse", { form_id: F.id, sub_id: crypto.randomUUID(), hp: $("hp").value, response: values(),
      files: Object.fromEntries(Object.keys(files).map(k => [k, true])), pdf: pdf.output("datauristring").split("base64,")[1] });
    $("area").classList.add("hidden"); $("done").classList.remove("hidden"); $("btnDl2").onclick = () => download(lastPdf); scrollTo(0, 0);
  } catch (x) { toast(x.message, "err"); sending = false; b.disabled = false; b.textContent = "Submit"; }
}
