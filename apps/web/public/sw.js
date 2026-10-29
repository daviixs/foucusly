/* Foucusly service worker — delivers Web Push reminders fired by the local API scheduler. */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "Foucusly", body: "", url: "/app" };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch (error) {
      payload = { ...payload, body: event.data.text() };
    }
  }
  const title = typeof payload.title === "string" && payload.title ? payload.title : "Foucusly";
  const options = {
    body: typeof payload.body === "string" ? payload.body : "",
    badge: "/favicon-32.png",
    data: { url: typeof payload.url === "string" ? payload.url : "/app" },
    vibrate: [120, 60, 120],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target =
    event.notification.data && typeof event.notification.data.url === "string" ? event.notification.data.url : "/app";
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientList) {
        if (client.url.includes("/app") && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })(),
  );
});
