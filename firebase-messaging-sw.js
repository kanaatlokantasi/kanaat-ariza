// Arka plan bildirimleri için servis çalışanı.
importScripts("https://www.gstatic.com/firebasejs/10.12.4/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.4/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDi4iTcY48wsF4GtyzZPdshfIDb4l_w3-0",
  authDomain: "kanaat-ariza.firebaseapp.com",
  projectId: "kanaat-ariza",
  storageBucket: "kanaat-ariza.firebasestorage.app",
  messagingSenderId: "861600751704",
  appId: "1:861600751704:web:a4649b7abe0492da582a2d"
});

const messaging = firebase.messaging();

// Sunucu yalnızca data gönderir, bildirimi burada gösteriyoruz.
messaging.onBackgroundMessage(payload => {
  const d = payload.data || {};
  self.registration.showNotification(d.title || "Kanaat Bakım", {
    body: d.body || "",
    tag: d.title || "kanaat",
    renotify: true,
    data: { link: d.link || "./" }
  });
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.link) || "./";
  event.waitUntil(clients.openWindow(url));
});
