import React from 'react';
import { createRoot } from 'react-dom/client';

createRoot(document.querySelector('#root')).render(
  React.createElement(
    'main',
    { id: 'scan-page' },
    React.createElement(
      'section',
      { id: 'scan-grid' },
      React.createElement('article', { className: 'scan-card', id: 'scan-card-1' }, 'One'),
      React.createElement('article', { className: 'scan-card', id: 'scan-card-2' }, 'Two'),
      React.createElement('article', { className: 'scan-card', id: 'scan-card-3' }, 'Three'),
    ),
  ),
);
