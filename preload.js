// Runs before the page loads. It tells the Cleer website it is inside the
// desktop app, which is what switches the bottom bar to the slide-out
// left sidebar (see components/BottomNav.tsx).
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('cleerDesktop', {
  platform: process.platform,
});
