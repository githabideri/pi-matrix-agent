/**
 * Main Entry Point
 *
 * Sets up the React app and handles room key selection.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChatInterface } from './ChatInterface';
import './styles.css';

function App() {
  // Get room key from URL query parameter or use default
  const [roomKey, setRoomKey] = React.useState(() => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('room') || 'test-room';
  });

  const [showRoomSelector, setShowRoomSelector] = React.useState(true);

  const handleRoomSelect = (key: string) => {
    setRoomKey(key);
    setShowRoomSelector(false);
  };

  if (showRoomSelector) {
    return (
      <div className="room-selector">
        <h1>Assistant UI Spike</h1>
        <p>Select a room to connect:</p>
        <div className="room-form">
          <input
            type="text"
            placeholder="Enter room key (e.g., test-room)"
            defaultValue={roomKey}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleRoomSelect(e.currentTarget.value.trim() || 'test-room');
              }
            }}
          />
          <button onClick={() => handleRoomSelect(roomKey)}>Connect</button>
        </div>
        <p className="hint">
          Room key is the hashed identifier for a Matrix room.
        </p>
      </div>
    );
  }

  return <ChatInterface roomKey={roomKey} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
