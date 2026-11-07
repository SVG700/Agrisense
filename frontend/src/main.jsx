import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import BatteryAdminPage from './components/BatteryAdminPage.jsx';
import './index.css';

// /battery-admin is a separate, battery-only portal (its own login); everything else is the main app
const isBatteryPortal = window.location.pathname.replace(/\/+$/, '') === '/battery-admin';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isBatteryPortal ? <BatteryAdminPage /> : <App />}
  </React.StrictMode>
);
