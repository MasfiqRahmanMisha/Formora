/* ===== CONFIG: Supabase > Project Settings > API ===== */
const SUPABASE_URL = "https://scanackhuamaxxdqjpit.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYW5hY2todWFtYXh4ZHFqcGl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxODM2NDMsImV4cCI6MjEwODc1OTY0M30.N_gbewDKbUzvAaHfH2sIJ7-ApKMa7t1vSTBGrrJpZUE";
const SB = (SUPABASE_URL.startsWith("https://") && window.supabase) ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;   // null = DEMO MODE

const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const api = (action, data = {}) => SB ? sbApi(action, data) : mockApi(action, data);
const newFormId = () => "F" + [...crypto.getRandomValues(new Uint8Array(9))].map(b => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[b % 62]).join("");

/* Supabase backend. Same actions as the demo backend, so admin.js / form.js do not care which one runs. */
async function sbApi(a, d) {
  const q = r => { if (r.error) throw new Error(r.error.message); return r.data; };
  switch (a) {
    case "config": return { success: true, auth: true };
    case "auth": {
      const { data: { session } } = await SB.auth.getSession();
      if (!session) throw new Error("Session expired");
      if (!q(await SB.rpc("is_admin"))) { await SB.auth.signOut(); throw new Error("This account is not allowed to manage forms."); }
      return { success: true, email: session.user.email };
    }
    case "getForms": {
      const rows = q(await SB.from("forms").select("id,company_name,form_title,status,fields,updated_at,responses(count)").order("updated_at", { ascending: false }));
      return { success: true, forms: rows.map(f => ({ ...f, response_count: (f.responses[0] || {}).count || 0 })) };
    }
    case "getForm": {
      if (d.admin) { const r = await SB.from("forms").select("*").eq("id", d.id).maybeSingle(); if (!q(r)) throw new Error("Form not found."); return { success: true, form: r.data }; }
      const f = q(await SB.rpc("get_public_form", { p_id: d.id }));
      if (!f) throw new Error("This form is not available.");
      return { success: true, form: f };
    }
    case "saveForm": {
      const f = d.form, row = { company_name: f.company_name, form_title: f.form_title, address: f.address || "", phone: f.phone || "", email: f.email || "",
        website: f.website || "", footer_text: f.footer_text || "", description: f.description || "", settings: f.settings || {}, fields: f.fields, status: f.status === "published" ? "published" : "draft", updated_at: new Date().toISOString() };
      if (f.remove_logo) row.logo = ""; if (f.logo_data) row.logo = f.logo_data;
      if (f.remove_banner) row.banner = ""; if (f.banner_data) row.banner = f.banner_data;
      if (f.id) { q(await SB.from("forms").update(row).eq("id", f.id)); return { success: true, form_id: f.id }; }
      const id = newFormId(); q(await SB.from("forms").insert({ ...row, id })); return { success: true, form_id: id };
    }
    case "deleteForm": {
      const ls = await SB.storage.from("pdfs").list(d.form_id);
      if (ls.data && ls.data.length) await SB.storage.from("pdfs").remove(ls.data.map(o => d.form_id + "/" + o.name));
      q(await SB.from("forms").delete().eq("id", d.form_id)); return { success: true };
    }
    case "getResponses": {
      const rows = q(await SB.from("responses").select("data,pdf_path,created_at").eq("form_id", d.form_id).order("created_at", { ascending: false }).limit(2000));
      return { success: true, responses: rows.map(r => ({ ...r.data, submitted_at: r.created_at, pdf_path: r.pdf_path })) };
    }
    case "submitResponse": {
      if (d.hp) return { success: true };
      const path = d.form_id + "/" + d.sub_id + ".pdf", bytes = Uint8Array.from(atob(d.pdf), c => c.charCodeAt(0));
      const up = await SB.storage.from("pdfs").upload(path, new Blob([bytes], { type: "application/pdf" }), { contentType: "application/pdf" });
      if (up.error) throw new Error("Could not save the PDF: " + up.error.message);
      const r = await SB.rpc("submit_response", { p_form_id: d.form_id, p_sub_id: d.sub_id, p_data: d.response, p_files: d.files, p_pdf_path: path });
      if (r.error) { await SB.storage.from("pdfs").remove([path]); if (r.error.code === "23505") return { success: true, duplicate: true }; throw new Error(r.error.message); }
      return { success: true };
    }
  }
  throw new Error("Unknown action");
}

function toast(msg, type = "ok") {
  const t = document.createElement("div");
  t.className = "toast " + type; t.textContent = msg;
  document.getElementById("toasts").appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

/* Resize + compress before upload (keeps payloads small and safe) */
function resizeImage(file, max, mime) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file), i = new Image();
    i.onload = () => {
      const k = Math.min(1, max / Math.max(i.width, i.height)), c = document.createElement("canvas");
      c.width = Math.round(i.width * k); c.height = Math.round(i.height * k);
      const x = c.getContext("2d");
      if (mime === "image/jpeg") { x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); }
      x.drawImage(i, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u); res(c.toDataURL(mime, 0.9));
    };
    i.onerror = () => rej(new Error("Invalid image"));
    i.src = u;
  });
}

/* ================= DEMO MODE (frontend only, localStorage) =================
   Used automatically while API_URL is not set. Same actions as the Apps Script backend. */
const DB = { get: k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (_) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { throw new Error("Browser storage is full. Use a smaller logo or delete old forms."); } } };
async function mockApi(a, d) {
  const forms = DB.get("sf_forms") || [], find = id => forms.find(f => f.id === id), cnt = id => (DB.get("sf_r_" + id) || []).length;
  const newId = () => "F" + [...crypto.getRandomValues(new Uint8Array(9))].map(b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
  switch (a) {
    case "config": return { success: true, auth: false, demo: true };
    case "auth": return { success: true };
    case "getForms": return { success: true, forms: forms.map(f => ({ ...f, logo: undefined, banner: undefined, response_count: cnt(f.id) })) };
    case "getForm": {
      const f = find(d.id);
      if (!f || (!d.admin && f.status !== "published")) throw new Error("Form not found. (Demo mode: forms exist only in the browser where they were created.)");
      return { success: true, form: f };
    }
    case "saveForm": {
      const f = d.form || {}, old = find(f.id), now = new Date().toISOString();
      if (!f.company_name || !f.form_title) throw new Error("Company name and form title are required.");
      if (!Array.isArray(f.fields) || !f.fields.length) throw new Error("Add at least one field.");
      const rec = { id: old ? old.id : newId(), company_name: f.company_name, form_title: f.form_title, address: f.address, phone: f.phone,
        email: f.email, website: f.website, footer_text: f.footer_text, description: f.description || "", settings: f.settings || {}, banner: f.remove_banner ? "" : (f.banner_data || (old && old.banner) || ""), fields: f.fields, status: f.status === "published" ? "published" : "draft",
        logo: f.remove_logo ? "" : (f.logo_data || (old && old.logo) || ""), created_at: old ? old.created_at : now, updated_at: now };
      DB.set("sf_forms", old ? forms.map(x => x.id === rec.id ? rec : x) : [...forms, rec]);
      return { success: true, form_id: rec.id };
    }
    case "deleteForm": DB.set("sf_forms", forms.filter(f => f.id !== d.form_id)); localStorage.removeItem("sf_r_" + d.form_id); return { success: true };
    case "getResponses": return { success: true, responses: [...(DB.get("sf_r_" + d.form_id) || [])].reverse() };
    case "submitResponse": {
      const f = find(d.form_id); if (!f || f.status !== "published") throw new Error("This form is not available.");
      const r = d.response || {}, row = { submitted_at: new Date().toISOString(), pdf_url: "" };
      f.fields.forEach(x => { if (["photo", "signature"].includes(x.type)) return; const v = Array.isArray(r[x.id]) ? r[x.id].join(", ") : String(r[x.id] || ""); row[x.id] = v; });
      DB.set("sf_r_" + f.id, [...(DB.get("sf_r_" + f.id) || []), row]); return { success: true };
    }
  }
  throw new Error("Unknown action");
}

/* Shared: render HTML into a multi-page A4 PDF (portrait or landscape). Breaks on row boundaries; logo watermark under content on every page. */
const _loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
const BRAND_TEXT = "Formora@Onu- \u0985\u09a3\u09c1";
function _brandImg() {   // small grey credit as an image, so the Bengali text renders with the browser's fonts
  const FPX = 40, PXMM = FPX / 2.5, c = document.createElement("canvas"), x = c.getContext("2d"), font = FPX + 'px system-ui,"Segoe UI","Noto Sans Bengali","Nirmala UI","Bangla Sangam MN",sans-serif';
  x.font = font; c.width = Math.ceil(x.measureText(BRAND_TEXT).width) + 4; c.height = Math.ceil(FPX * 1.3);
  x.font = font; x.fillStyle = "#787878"; x.textBaseline = "alphabetic"; x.fillText(BRAND_TEXT, 2, FPX);
  return { url: c.toDataURL("image/png"), w: c.width / PXMM, h: c.height / PXMM, base: FPX / PXMM };
}
/* Banner: always exactly 1200 x 300 px (4:1). Any image is centre-cropped to fit. */
async function bannerImage(file) {
  const img = await new Promise((res, rej) => { const i = new Image(), u = URL.createObjectURL(file);
    i.onload = () => { URL.revokeObjectURL(u); res(i); }; i.onerror = () => { URL.revokeObjectURL(u); rej(new Error("Could not read this image.")); }; i.src = u; });
  const W = 1200, H = 300, c = document.createElement("canvas"); c.width = W; c.height = H;
  const s = Math.max(W / img.width, H / img.height), w = img.width * s, h = img.height * s, x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); x.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  for (const qlt of [0.85, 0.7, 0.55]) { const u = c.toDataURL("image/jpeg", qlt); if (u.length < 380000) return u; }
  throw new Error("This banner is too detailed. Try a simpler or smaller image.");
}
async function htmlToPdf(build, logo, land) {
  const host = document.getElementById("capHost"), node = document.createElement("div");
  node.className = "paper cap" + (land ? " land" : ""); host.appendChild(node); build(node);
  await Promise.all([...node.querySelectorAll("img")].map(i => i.decode().catch(() => 0)));
  const S = 2, canvas = await html2canvas(node, { scale: S, backgroundColor: null, useCORS: true }), top = node.getBoundingClientRect().top;
  const ends = [...node.querySelectorAll(".paper-header,.pdf-row,.sig-row,.paper-footer,tr")].map(e => Math.round((e.getBoundingClientRect().bottom - top) * S));
  host.removeChild(node);
  const PW = land ? 297 : 210, PH = land ? 210 : 297, M = 12, { jsPDF } = window.jspdf, pdf = new jsPDF(land ? "l" : "p", "mm", "a4");
  const W = canvas.width, mm = W / PW, pageH = Math.floor((PH - 2 * M) * mm), pages = []; let y = 0;
  while (y < canvas.height) {
    let end = Math.min(y + pageH, canvas.height);
    if (end < canvas.height) { const ok = ends.filter(b => b > y + pageH * 0.4 && b <= end); if (ok.length) end = Math.max(...ok); }
    pages.push([y, end]); y = end;
  }
  const wm = logo ? await _loadImg(logo) : null, brand = _brandImg();
  pages.forEach(([a, b], n) => {
    if (n) pdf.addPage();
    if (wm) {
      const k = Math.min(110 / wm.width, 110 / wm.height), w = wm.width * k, h = wm.height * k;
      pdf.saveGraphicsState(); pdf.setGState(new pdf.GState({ opacity: 0.08 }));
      pdf.addImage(logo, "PNG", (PW - w) / 2, (PH - h) / 2, w, h); pdf.restoreGraphicsState();
    }
    const c = document.createElement("canvas"); c.width = W; c.height = b - a;
    c.getContext("2d").drawImage(canvas, 0, a, W, b - a, 0, 0, W, b - a);
    pdf.addImage(c.toDataURL("image/png"), "PNG", 0, M, PW, (b - a) / mm);
    pdf.setFontSize(8); pdf.setTextColor(120); pdf.text(`Page ${n + 1} / ${pages.length}`, PW / 2, PH - 6, { align: "center" });
    pdf.addImage(brand.url, "PNG", PW - M - brand.w, PH - 6 - brand.base, brand.w, brand.h);   // bottom-right credit
  });
  return pdf;
}
