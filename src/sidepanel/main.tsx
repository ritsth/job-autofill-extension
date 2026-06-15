import React from 'react';
import { createRoot } from 'react-dom/client';
import { Popup } from '../popup/Popup';
import '../ui/ui.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>,
);
