import { firebaseConfig, VAPID_KEY } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getFirestore, doc, collection, setDoc, addDoc, updateDoc, deleteDoc, arrayUnion, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getMessaging, getToken, isSupported } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-messaging.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const LOC = ["Mutfak","Salon","Müşteri Bay Tuvaleti","Müşteri Bayan Tuvaleti","Personel Soyunma Odası","Büyük Depo","Üst Kat Depo","Soğuk hava deposu","Dış alan","Diğer"];
const SHORT_LOC = ["Büyük Depo","Üst Kat Depo","Mutfak","Vitrin","Soğuk hava deposu","Diğer"];
const TYPES = ["Su kaçağı","Fotoselli musluk arızası","Kırık ekipman","Elektrik","Klima / soğutma","Diğer"];
const ACIL = ["Su kaçağı","Elektrik"];
const PRI = ["Düşük","Orta","Yüksek","Acil"];
const ISLEM = ["Periyodik bakım","Arıza onarımı","Parça değişimi","Rutin yağlama","Filtre kontrolü","Genel temizlik","Diğer"];
const DURUM = ["Bitmek üzere","Bitti"];
const ST = { acik: "Açık", islemde: "İşlemde", siparis: "Sipariş verildi", kapandi: "Kapandı" };
const ROLES = { staff: "Personel", teknik: "Teknik müdür", admin: "Yönetici" };
const ERR = {
  "auth/invalid-credential": "Kullanıcı adı veya şifre hatalı.",
  "auth/wrong-password": "Kullanıcı adı veya şifre hatalı.",
  "auth/user-not-found": "Kullanıcı adı veya şifre hatalı.",
  "auth/email-already-in-use": "Bu kullanıcı adı zaten alınmış.",
  "auth/weak-password": "Şifre en az 6 karakter olmalı.",
  "auth/invalid-email": "Kullanıcı adı geçersiz. Yalnızca harf, rakam, nokta ve tire kullanın.",
  "auth/too-many-requests": "Çok fazla deneme yapıldı. Biraz bekleyin.",
  "auth/network-request-failed": "İnternet bağlantısı yok.",
  "permission-denied": "Bu işlem için yetkiniz yok."
};

let user = null, me = null, authMode = "login", flash = "", pushDone = false;
let unsubMe = null, unsubs = [], dataSig = "";
const D = { equipment: [], faults: [], shortages: [], products: [], maint: [], users: [] };

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const iso = () => new Date().toISOString();
const today = () => iso().slice(0, 10);
const fmt = v => v ? new Date(v).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
const fmtD = v => v ? new Date(v + "T00:00:00").toLocaleDateString("tr-TR") : "";
const byNew = (a, b) => (b.createdAt || "").localeCompare(a.createdAt || "");
const opts = (arr, sel) => arr.map(v => `<option ${v === sel ? "selected" : ""}>${esc(v)}</option>`).join("");
const stOpts = (keys, sel) => keys.map(k => `<option value="${k}" ${k === sel ? "selected" : ""}>${ST[k]}</option>`).join("");
const empty = t => `<p class="muted">${t}</p>`;
const isApproved = () => me?.approved === true;
const isAdmin = () => isApproved() && me.role === "admin";
const isTech = () => isApproved() && (me.role === "admin" || me.role === "teknik");
const myName = () => me?.name ? `${me.name} ${me.surname || ""}`.trim() : (user?.displayName || "");
const lastMaint = id => { const m = D.maint.filter(x => x.eqId === id).sort(byNew)[0]; return m ? fmt(m.createdAt) : "yok"; };
const curRoute = () => decodeURIComponent(location.hash.slice(1));
const errMsg = e => ERR[e?.code] || e?.message || "Bir hata oluştu.";

const TR = { ı: "i", ğ: "g", ü: "u", ş: "s", ö: "o", ç: "c", İ: "i", Ğ: "g", Ü: "u", Ş: "s", Ö: "o", Ç: "c" };
const normUser = s => s.trim().replace(/[ıİğĞüÜşŞöÖçÇ]/g, c => TR[c]).toLowerCase().replace(/\s+/g, ".").replace(/[^a-z0-9._-]/g, "");
const toEmail = u => `${u}@kanaat-ariza.app`;

async function shrink(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const r = Math.min(1, 640 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL("image/jpeg", 0.5));
    };
    img.onerror = () => rej(new Error("Fotoğraf okunamadı."));
    img.src = url;
  });
}

// ---------- Görünüm ----------
function page(html) {
  const f = flash; flash = "";
  $("#app").innerHTML = (f ? `<div class="note">${esc(f)}</div>` : "") + html;
  $("#nav").innerHTML = isApproved() ? nav() : "";
  $("#who").textContent = isApproved() ? `${myName()} · ${ROLES[me.role] || ""}` : "";
}

function nav() {
  const t = [["", "Ana"], ["ariza", "Arıza"], ["eksik", "Eksik"], ["ekipman", "Ekipman"]];
  if (isAdmin()) t.push(["yonetim", "Yönetim"]);
  const cur = curRoute().split("/")[0];
  return t.map(([h, l]) => `<a href="#${h}" class="${cur === h ? "on" : ""}">${l}</a>`).join("");
}

function route() {
  if (!user) return showAuth();
  if (!me) return page(`<section class="card"><p class="muted">Hesabınız hazırlanıyor…</p></section>${logoutBtn()}`);
  if (!isApproved()) return page(`<section class="card"><h2>${me.decidedAt ? "Erişim kapalı" : "Onay bekleniyor"}</h2>
    <p class="muted">${me.decidedAt ? "Erişiminiz kapatıldı. Yönetici ile görüşün." : "Kaydınız alındı. Yönetici onayladığında bu sayfayı yenileyin."}</p></section>${logoutBtn()}`);

  const [r, arg] = curRoute().split("/");
  switch (r) {
    case "ariza": return page(faultPage(arg));
    case "eksik": return page(shortPage());
    case "ekipman": return page(arg ? eqDetail(arg) : eqList());
    case "yonetim": return page(isAdmin() ? adminPage() : home());
    default: return page(home());
  }
}

function refresh() {
  const a = document.activeElement;
  if (a && a.closest && a.closest("form")) return; // yazı yazılırken ekranı yenileme
  route();
}

function logoutBtn() { return `<p style="text-align:center"><button class="link" data-act="logout">Çıkış yap</button></p>`; }

function showAuth() {
  const reg = authMode === "register";
  $("#nav").innerHTML = ""; $("#who").textContent = "";
  $("#app").innerHTML = (flash ? `<div class="warn">${esc(flash)}</div>` : "") + `<section class="card"><h2>${reg ? "Kayıt ol" : "Giriş"}</h2>
    <p class="muted">${reg ? "Kayıt olduktan sonra yönetici onayı gerekir." : "Kullanıcı adı ve şifrenizle giriş yapın."}</p>
    <form id="af">
      ${reg ? `<label>Ad<input name="name" required autocomplete="given-name"></label>
      <label>Soyad<input name="surname" required autocomplete="family-name"></label>` : ""}
      <label>Kullanıcı adı<input name="username" required autocapitalize="none" autocorrect="off" autocomplete="username"></label>
      <label>Şifre<input name="password" type="password" required minlength="6" autocomplete="${reg ? "new-password" : "current-password"}"></label>
      <button class="btn big" style="margin-top:14px">${reg ? "Kayıt ol" : "Giriş yap"}</button>
      <p class="err"></p>
    </form></section>
    <p style="text-align:center"><button class="link" data-act="toggle-auth">${reg ? "Zaten hesabınız var mı? Giriş yapın" : "Hesabınız yok mu? Kayıt olun"}</button></p>`;
  flash = "";
}

function pushBanner() {
  if (!("Notification" in window) || Notification.permission === "granted") return "";
  const denied = Notification.permission === "denied";
  return `<section class="card"><p>${denied ? "Bildirimler kapalı. Telefon ayarlarından açabilirsiniz." : "Arıza ve eksik ürün bildirimleri telefonunuza gelsin mi?"}</p>
    ${denied ? "" : `<button class="btn" data-act="notif">Bildirimleri aç</button>`}
    <p class="muted">iPhone'da önce uygulamayı ana ekrana ekleyin.</p></section>`;
}

function faultItem(f) {
  const acil = f.priority === "Acil" || f.priority === "Yüksek";
  const sel = isTech() ? `<select data-fst="${esc(f.id)}" style="margin-top:6px">${stOpts(["acik", "islemde", "kapandi"], f.status)}</select>` : "";
  return `<div class="item"><b>${esc(f.type)}</b><span class="pill ${acil ? "p-acil" : ""}">${esc(f.priority)}</span>
    <span class="muted">${esc(f.loc)}${f.eqName ? " · " + esc(f.eqName) : ""} · ${esc(f.name)} · ${fmt(f.createdAt)} · ${ST[f.status] || ""}</span>
    ${f.desc ? `<p>${esc(f.desc)}</p>` : ""}${f.photo ? `<img class="ph" src="${f.photo}" alt="">` : ""}${sel}</div>`;
}

function shortItem(s) {
  const sel = isAdmin() ? `<select data-sst="${esc(s.id)}" style="margin-top:6px">${stOpts(["acik", "siparis", "kapandi"], s.status)}</select>` : "";
  return `<div class="item"><b>${esc(s.urun)}</b><span class="pill ${s.durum === "Bitti" ? "p-acil" : ""}">${esc(s.durum)}</span>
    <span class="muted">${esc(s.konum)} · ${esc(s.name)} · ${fmt(s.createdAt)} · ${ST[s.status] || ""}</span>
    ${s.note ? `<p>${esc(s.note)}</p>` : ""}${s.photo ? `<img class="ph" src="${s.photo}" alt="">` : ""}${sel}</div>`;
}

function home() {
  const open = D.faults.filter(f => f.status !== "kapandi").sort(byNew);
  const sh = D.shortages.filter(s => s.status !== "kapandi").sort(byNew);
  return `${pushBanner()}
    <a class="btn red big" href="#ariza">Arıza bildir</a>
    <a class="btn dark big" href="#eksik">Eksik ürün bildir</a>
    <h3>Açık arızalar (${open.length})</h3>${open.slice(0, 15).map(faultItem).join("") || empty("Açık arıza yok.")}
    <h3>Açık eksik ürünler (${sh.length})</h3>${sh.slice(0, 15).map(shortItem).join("") || empty("Açık eksik ürün yok.")}`;
}

function faultPage(eqId) {
  const e = D.equipment.find(x => x.id === eqId);
  const list = D.faults.slice().sort(byNew).slice(0, 30).map(faultItem).join("") || empty("Arıza kaydı yok.");
  return `<section class="card"><h2>Arıza bildir</h2><p class="muted">Bildiren: ${esc(myName())}</p>
    <form id="ff">
      <label>Ekipman (isteğe bağlı)<select name="eqId"><option value="">Genel arıza (etiketsiz)</option>
        ${D.equipment.map(x => `<option value="${esc(x.id)}" ${x.id === eqId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
      <label>Konum<select name="loc">${opts(LOC, e?.location)}</select></label>
      <label>Arıza türü<select name="type" id="ftype">${opts(TYPES)}</select></label>
      <label>Öncelik<select name="priority" id="fpri">${opts(PRI, "Orta")}</select></label>
      <label>Açıklama<textarea name="desc" rows="3" placeholder="Ne oldu, nerede?"></textarea></label>
      <label>Fotoğraf (isteğe bağlı)<input name="photo" type="file" accept="image/*"></label>
      <button class="btn red big" style="margin-top:14px">Bildir</button><p class="err"></p>
    </form></section>
    <h3>Son arızalar</h3>${list}`;
}

function shortPage() {
  const prods = D.products.slice().sort((a, b) => (a.ad || "").localeCompare(b.ad || "", "tr"));
  const form = prods.length
    ? `<form id="sf">
        <label>Ürün<select name="urun">${prods.map(p => `<option>${esc(p.ad)}</option>`).join("")}</select></label>
        <label>Durum<select name="durum">${opts(DURUM)}</select></label>
        <label>Konum<select name="konum">${opts(SHORT_LOC)}</select></label>
        <label>Not<textarea name="note" rows="2" placeholder="Örn. 2 kasa kaldı"></textarea></label>
        <label>Fotoğraf (isteğe bağlı)<input name="photo" type="file" accept="image/*"></label>
        <button class="btn dark big" style="margin-top:14px">Bildir</button><p class="err"></p>
      </form>`
    : `<div class="warn">Ürün listesi boş. Yönetici ürünleri ekleyene kadar bildirim yapılamaz.</div>`;
  const list = D.shortages.filter(s => s.status !== "kapandi").sort(byNew).map(shortItem).join("") || empty("Açık eksik ürün yok.");
  return `<section class="card"><h2>Eksik ürün bildir</h2><p class="muted">Bildiren: ${esc(myName())}</p>${form}</section>
    <h3>Açık eksik ürünler</h3>${list}`;
}

function eqList() {
  const list = D.equipment.slice().sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0) || (a.name || "").localeCompare(b.name || "", "tr"));
  return `<h2>Ekipmanlar</h2>` + (list.map(e => `<a class="item" href="#ekipman/${esc(e.id)}"><b>${esc(e.name)}</b>
    ${e.priority ? '<span class="pill p-acil">Öncelikli</span>' : ""}
    <span class="muted">${esc(e.location)} · Son bakım: ${esc(lastMaint(e.id))}</span></a>`).join("") || empty("Henüz ekipman yok."));
}

function eqDetail(id) {
  const e = D.equipment.find(x => x.id === id);
  if (!e) return `<p>Ekipman bulunamadı.</p><a class="btn ghost" href="#ekipman">Ekipmanlar</a>`;
  const hist = D.maint.filter(m => m.eqId === id).sort(byNew);
  const next = hist.find(m => m.nextDate);
  const overdue = next && next.nextDate < today();
  const fl = D.faults.filter(f => f.eqId === id).sort(byNew);
  return `<section class="card"><h2>${esc(e.name)} ${e.priority ? '<span class="pill p-acil">Öncelikli</span>' : ""}</h2>
    <p class="muted">Konum: ${esc(e.location)}<br>Marka/Model: ${esc(e.model || "-")}<br>
    Servis: ${esc(e.service || "-")} ${e.servicePhone ? `· <a href="tel:${esc(e.servicePhone)}">${esc(e.servicePhone)}</a>` : ""}<br>
    Garanti bitişi: ${fmtD(e.warranty) || "-"}</p>
    ${next ? `<p class="${overdue ? "err" : "muted"}">Sonraki bakım: ${fmtD(next.nextDate)}${overdue ? " (gecikti)" : ""}</p>` : ""}
    <a class="btn red" href="#ariza/${esc(id)}">Arıza bildir</a></section>
    <section class="card"><h3 style="margin-top:0">Bakım kaydı gir</h3>
    <form id="mf"><input type="hidden" name="eqId" value="${esc(id)}">
      <label>Yapılan işlem<select name="islem">${opts(ISLEM)}</select></label>
      <label>Açıklama<textarea name="desc" rows="2"></textarea></label>
      <label>Sonraki bakım tarihi<input name="nextDate" type="date"></label>
      <button class="btn big" style="margin-top:12px">Kaydet</button><p class="err"></p>
    </form></section>
    <h3>Bakım geçmişi</h3>
    ${hist.map(m => `<div class="item"><b>${esc(m.islem)}</b><span class="muted">${fmt(m.createdAt)} · ${esc(m.name)}</span>${m.desc ? `<p>${esc(m.desc)}</p>` : ""}</div>`).join("") || empty("Bakım kaydı yok.")}
    <h3>Arıza kayıtları</h3>${fl.map(faultItem).join("") || empty("Arıza kaydı yok.")}`;
}

function adminPage() {
  const users = D.users.slice().sort((a, b) => (a.approved === true ? 1 : 0) - (b.approved === true ? 1 : 0) || (a.name || "").localeCompare(b.name || "", "tr"));
  const userRows = users.map(u => {
    const self = u.id === user.uid;
    const state = u.approved === true ? "Onaylı" : (u.decidedAt ? "Kapalı" : "Bekliyor");
    return `<div class="item"><b>${esc(u.name || "")} ${esc(u.surname || "")}</b> <span class="muted">@${esc(u.username || "")}</span>
      <span class="pill ${u.approved === true ? "" : "p-acil"}">${state}</span>
      <div class="row"><select data-role="${esc(u.id)}" ${self ? "disabled" : ""}>
        ${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === u.role ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div class="row">${u.approved === true
        ? `<button class="btn ghost" data-act="revoke" data-id="${esc(u.id)}" ${self ? "disabled" : ""}>Yetkiyi kaldır</button>`
        : `<button class="btn green" data-act="approve" data-id="${esc(u.id)}">Onayla</button>`}</div></div>`;
  }).join("");

  const eqRows = D.equipment.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "", "tr")).map(e => `
    <div class="item"><b>${esc(e.name)}</b> ${e.priority ? '<span class="pill p-acil">Öncelikli</span>' : ""}
      <span class="muted">${esc(e.location)}</span>
      <div class="row">
        <button class="btn ghost" data-act="qr" data-id="${esc(e.id)}">QR göster</button>
        <button class="btn ghost" data-act="prio" data-id="${esc(e.id)}" data-v="${e.priority ? 1 : 0}">${e.priority ? "Öncelikten çıkar" : "Öncelikli yap"}</button>
        <button class="btn red" data-act="deleq" data-id="${esc(e.id)}">Sil</button>
      </div></div>`).join("") || empty("Henüz ekipman yok.");

  const prodRows = D.products.slice().sort((a, b) => (a.ad || "").localeCompare(b.ad || "", "tr")).map(p => `
    <div class="item"><b>${esc(p.ad)}</b>
      <div class="row"><button class="btn red" data-act="delprod" data-id="${esc(p.id)}">Sil</button></div></div>`).join("") || empty("Ürün yok.");

  return `<h2>Yönetim</h2>
    <h3>Kullanıcılar</h3>${userRows || empty("Kullanıcı yok.")}
    <h3>Ekipman ekle</h3>
    <form id="ef" class="card">
      <label>Ad *<input name="name" required></label>
      <label>Marka / Model<input name="model"></label>
      <label>Konum<select name="location">${opts(LOC)}</select></label>
      <label>Servis firması<input name="service" placeholder="Örn. Form Klima"></label>
      <label>Servis telefonu<input name="servicePhone" type="tel"></label>
      <label>Garanti bitişi<input name="warranty" type="date"></label>
      <label class="muted" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input name="priority" type="checkbox" style="width:auto"> Öncelikli (QR/etiket takılacak)</label>
      <button class="btn big" style="margin-top:12px">Ekle</button><p class="err"></p>
    </form>
    <h3>Ekipmanlar</h3>${eqRows}
    <div id="qrbox"></div>
    <h3>Ürün listesi (eksik ürün bildirimi için)</h3>
    <form id="uf" class="card">
      <label>Yeni ürün<input name="ad" placeholder="Örn. Süt 1L" required></label>
      <button class="btn" style="margin-top:8px">Ekle</button><p class="err"></p>
    </form>
    ${prodRows}`;
}

function showQR(id) {
  const url = location.href.split("#")[0] + "#ekipman/" + id;
  const box = $("#qrbox");
  if (!box) return;
  box.innerHTML = `<div class="card"><div id="qrc"></div><p class="mono">${esc(url)}</p>
    <p class="muted">Bu adresi QR olarak metal plakaya basıp makineye takın.</p></div>`;
  if (window.QRCode) new QRCode(document.getElementById("qrc"), { text: url, width: 200, height: 200 });
}

// ---------- Kimlik ve veri ----------
async function submitAuth(f) {
  const d = Object.fromEntries(new FormData(f));
  const u = normUser(d.username || "");
  if (!u) throw new Error("Kullanıcı adı geçersiz. Harf ve rakam kullanın.");
  if (authMode === "login") {
    await signInWithEmailAndPassword(auth, toEmail(u), d.password);
    return;
  }
  const name = d.name.trim(), surname = d.surname.trim();
  const cred = await createUserWithEmailAndPassword(auth, toEmail(u), d.password);
  await updateProfile(cred.user, { displayName: `${name} ${surname}` });
  await setDoc(doc(db, "users", cred.user.uid), {
    name, surname, username: u, approved: false, role: "staff", fcmTokens: [], createdAt: iso()
  });
}

async function submitFault(f) {
  const d = Object.fromEntries(new FormData(f));
  const file = f.elements.photo.files[0];
  const eq = D.equipment.find(x => x.id === d.eqId);
  const obj = {
    eqId: d.eqId || null, eqName: eq?.name || "", loc: d.loc, type: d.type, priority: d.priority,
    desc: (d.desc || "").trim(), status: "acik", name: myName(), uid: user.uid, createdAt: iso()
  };
  if (file && file.size) obj.photo = await shrink(file);
  await addDoc(collection(db, "faults"), obj);
  flash = "Arıza bildirildi.";
  location.hash = "ariza";
  route();
}

async function submitShort(f) {
  const d = Object.fromEntries(new FormData(f));
  const file = f.elements.photo.files[0];
  const obj = {
    urun: d.urun, durum: d.durum, konum: d.konum, note: (d.note || "").trim(),
    status: "acik", name: myName(), uid: user.uid, createdAt: iso()
  };
  if (file && file.size) obj.photo = await shrink(file);
  await addDoc(collection(db, "shortages"), obj);
  flash = "Eksik ürün bildirildi.";
  location.hash = "eksik";
  route();
}

async function submitMaint(f) {
  const d = Object.fromEntries(new FormData(f));
  const eq = D.equipment.find(x => x.id === d.eqId);
  await addDoc(collection(db, "maintenance"), {
    eqId: d.eqId, eqName: eq?.name || "", islem: d.islem, desc: (d.desc || "").trim(),
    nextDate: d.nextDate || null, name: myName(), uid: user.uid, createdAt: iso()
  });
  flash = "Bakım kaydı girildi.";
  route();
}

async function submitEquip(f) {
  const d = Object.fromEntries(new FormData(f));
  await addDoc(collection(db, "equipment"), {
    name: d.name.trim(), model: (d.model || "").trim(), location: d.location,
    service: (d.service || "").trim(), servicePhone: (d.servicePhone || "").trim(),
    warranty: d.warranty || null, priority: !!d.priority, createdAt: iso()
  });
  flash = "Ekipman eklendi.";
  route();
}

async function submitProduct(f) {
  const d = Object.fromEntries(new FormData(f));
  await addDoc(collection(db, "products"), { ad: d.ad.trim(), createdAt: iso() });
  flash = "Ürün eklendi.";
  route();
}

const FORMS = { af: submitAuth, ff: submitFault, sf: submitShort, mf: submitMaint, ef: submitEquip, uf: submitProduct };

document.addEventListener("submit", ev => {
  ev.preventDefault();
  const f = ev.target;
  const h = FORMS[f.id];
  if (!h) return;
  const btn = f.querySelector("button");
  if (btn) btn.disabled = true;
  h(f).catch(e => {
    const el = f.querySelector(".err");
    if (el) el.textContent = errMsg(e);
    else { flash = errMsg(e); route(); }
  }).finally(() => { if (btn) btn.disabled = false; });
});

document.addEventListener("change", async ev => {
  const t = ev.target;
  try {
    if (t.id === "ftype" && ACIL.includes(t.value)) $("#fpri").value = "Acil";
    if (t.dataset.fst) await updateDoc(doc(db, "faults", t.dataset.fst), { status: t.value });
    if (t.dataset.sst) await updateDoc(doc(db, "shortages", t.dataset.sst), { status: t.value });
    if (t.dataset.role) await updateDoc(doc(db, "users", t.dataset.role), { role: t.value });
  } catch (e) { flash = errMsg(e); route(); }
});

document.addEventListener("click", async ev => {
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  const id = b.dataset.id, act = b.dataset.act;
  try {
    if (act === "toggle-auth") { authMode = authMode === "login" ? "register" : "login"; flash = ""; return route(); }
    if (act === "logout") return signOut(auth);
    if (act === "notif") return enablePush(false);
    if (act === "qr") return showQR(id);
    if (act === "approve") await updateDoc(doc(db, "users", id), { approved: true, decidedAt: iso() });
    if (act === "revoke" && confirm("Bu kişinin erişimi kapatılsın mı?")) await updateDoc(doc(db, "users", id), { approved: false, decidedAt: iso() });
    if (act === "delprod" && confirm("Ürün listeden silinsin mi?")) await deleteDoc(doc(db, "products", id));
    if (act === "deleq" && confirm("Ekipman silinsin mi?")) await deleteDoc(doc(db, "equipment", id));
    if (act === "prio") await updateDoc(doc(db, "equipment", id), { priority: b.dataset.v !== "1" });
  } catch (e) { flash = errMsg(e); route(); }
});

async function enablePush(silent) {
  try {
    if (!(await isSupported())) throw new Error("Bu tarayıcı bildirimleri desteklemiyor. iPhone'da uygulamayı ana ekrana ekleyip oradan açın.");
    const perm = silent ? Notification.permission : await Notification.requestPermission();
    if (perm !== "granted") {
      if (!silent) { flash = "Bildirim izni verilmedi. Telefon ayarlarından açabilirsiniz."; route(); }
      return;
    }
    const reg = await navigator.serviceWorker.register("./firebase-messaging-sw.js");
    const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (token) await updateDoc(doc(db, "users", user.uid), { fcmTokens: arrayUnion(token) });
    if (!silent) { flash = "Bildirimler açıldı."; route(); }
  } catch (e) {
    if (!silent) { flash = e.message || errMsg(e); route(); }
  }
}

function syncData() {
  const sig = isApproved() ? me.role : "";
  if (sig === dataSig) return;
  dataSig = sig;
  unsubs.forEach(f => f()); unsubs = [];
  if (!sig) return;
  const sub = (col, key) => unsubs.push(onSnapshot(collection(db, col),
    s => { D[key] = s.docs.map(d => ({ ...d.data(), id: d.id })); refresh(); },
    e => { flash = errMsg(e); refresh(); }));
  sub("equipment", "equipment");
  sub("faults", "faults");
  sub("shortages", "shortages");
  sub("products", "products");
  sub("maintenance", "maint");
  if (sig === "admin") sub("users", "users");
}

function startMe(u) {
  if (unsubMe) unsubMe();
  unsubMe = onSnapshot(doc(db, "users", u.uid), s => {
    me = s.exists() ? { id: u.uid, ...s.data() } : null;
    syncData();
    if (isApproved() && !pushDone && "Notification" in window && Notification.permission === "granted") {
      pushDone = true;
      enablePush(true);
    }
    refresh();
  }, e => { flash = errMsg(e); refresh(); });
}

onAuthStateChanged(auth, u => {
  user = u;
  if (unsubMe) { unsubMe(); unsubMe = null; }
  unsubs.forEach(f => f()); unsubs = []; dataSig = ""; me = null;
  D.equipment = []; D.faults = []; D.shortages = []; D.products = []; D.maint = []; D.users = [];
  if (u) startMe(u);
  route();
});

window.addEventListener("hashchange", route);
