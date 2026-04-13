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
  const urlParams = React.useMemo(() => new URLSearchParams(window.location.search), []);
  const urlRoomKey = urlParams.get('room');
  const initialRoomKey = urlRoomKey || 'test-room';
  const hasUrlRoomKey = !!urlRoomKey;

  const [roomKey, setRoomKey] = React.useState(initialRoomKey);
  const [inputValue, setInputValue] = React.useState(initialRoomKey);
  const [showRoomSelector, setShowRoomSelector] = React.useState(!hasUrlRoomKey);

  const handleRoomSelect = (key: string) => {
    const trimmedKey = key.trim() || 'test-room';
    setRoomKey(trimmedKey);
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
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleRoomSelect(inputValue);
              }
            }}
          />
          <button onClick={() => handleRoomSelect(inputValue)}>Connect</button>
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
