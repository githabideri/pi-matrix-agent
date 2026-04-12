/**
 * Main entry point for the operator UI.
 */

import './styles.css';
import { RoomView } from './room.js';

function init(): void {
  // Room key is injected by the server into window.ROOM_KEY
  const roomKey = (window as any).ROOM_KEY;
  
  if (!roomKey) {
    document.body.innerHTML = `
      <div style="padding: 2rem; font-family: system-ui, sans-serif;">
        <h1>Operator UI</h1>
        <p>No room key found.</p>
        <p>Please access via <code>/app/room/:roomKey</code></p>
      </div>
    `;
    return;
  }
  
  const app = document.getElementById('app');
  if (!app) {
    console.error('No #app element found');
    return;
  }
  
  const roomView = new RoomView(roomKey);
  app.appendChild(roomView.render());
}

init();
