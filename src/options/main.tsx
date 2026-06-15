import React from 'react';
import { createRoot } from 'react-dom/client';
import { Options } from './Options';
import '../ui/ui.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Options />
  </React.StrictMode>,
);
