// Bildirim gönderici. GitHub Actions tarafından çalıştırılır.
//  - Her 30 dakikada: yeni erişim talepleri, yeni arıza ve eksik ürünler (teknik müdür / yönetici)
//  - Her gün 13:00 (İstanbul) : açık arıza ve eksik ürün hatırlatması
import admin from "firebase-admin";

const APP_URL = process.env.APP_URL || "https://kanaatlokantasi.github.io/kanaat-ariza/";
const DAILY = process.env.SCHEDULE === "0 10 * * *"; // 10:00 UTC = 13:00 İstanbul
const DAY = 24 * 60 * 60 * 1000;

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
});
const db = admin.firestore();
const messaging = admin.messaging();

async function usersWithRoles(roles) {
  const s = await db.collection("users").where("approved", "==", true).get();
  return s.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => roles.includes(u.role));
}

async function push(users, title, body) {
  const tokens = [...new Set(users.flatMap(u => u.fcmTokens || []))];
  if (!tokens.length) return;
  const res = await messaging.sendEachForMulticast({
    tokens,
    data: { title, body, link: APP_URL },
    webpush: { fcmOptions: { link: APP_URL } }
  });
  // Artık geçersiz olan cihaz anahtarlarını temizle
  const dead = [];
  res.responses.forEach((r, i) => {
    const code = r.error?.code || "";
    if (!r.success && /registration-token-not-registered|invalid-registration-token/.test(code)) dead.push(tokens[i]);
  });
  for (const t of dead) {
    const s = await db.collection("users").where("fcmTokens", "array-contains", t).get();
    await Promise.all(s.docs.map(d => d.ref.update({ fcmTokens: admin.firestore.FieldValue.arrayRemove(t) })));
  }
}

async function announce(col, title, text, recipients) {
  const s = await db.collection(col).get();
  for (const d of s.docs) {
    const x = d.data();
    if (x.notified) continue;
    const fresh = x.createdAt && Date.now() - Date.parse(x.createdAt) < DAY;
    if (fresh && (x.status || "acik") !== "kapandi") await push(recipients, title, text(x));
    await d.ref.update({ notified: true });
  }
}

async function poll() {
  const admins = await usersWithRoles(["admin"]);
  const tech = await usersWithRoles(["admin", "teknik"]);

  // Yeni erişim talepleri (yalnızca yöneticiye)
  const pending = await db.collection("users").where("approved", "==", false).get();
  for (const d of pending.docs) {
    const u = d.data();
    if (u.decidedAt || u.notifiedPending) continue;
    await push(admins, "Yeni erişim talebi", `${u.name || ""} ${u.surname || ""} (${u.username || ""})`.trim());
    await d.ref.update({ notifiedPending: true });
  }

  await announce("faults", "Yeni arıza", x => `${x.type} · ${x.loc} · ${x.priority}`, tech);
  await announce("shortages", "Eksik ürün", x => `${x.urun} · ${x.konum} · ${x.durum}`, tech);
}

async function daily() {
  const tech = await usersWithRoles(["admin", "teknik"]);
  const faults = (await db.collection("faults").get()).docs.map(d => d.data()).filter(x => x.status !== "kapandi");
  const shorts = (await db.collection("shortages").get()).docs.map(d => d.data()).filter(x => x.status !== "kapandi");
  if (!faults.length && !shorts.length) return;

  const lines = [
    ...faults.slice(0, 3).map(x => `Arıza: ${x.type} · ${x.loc}`),
    ...shorts.slice(0, 2).map(x => `Eksik: ${x.urun} · ${x.konum}`)
  ];
  const more = faults.length + shorts.length > lines.length ? " …" : "";
  await push(
    tech,
    `Günlük hatırlatma: ${faults.length} açık arıza, ${shorts.length} eksik ürün`,
    lines.join(" | ") + more
  );
}

(DAILY ? daily() : poll())
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
