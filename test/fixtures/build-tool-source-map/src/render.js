import React from 'react';
import { createRoot } from 'react-dom/client';

export function renderFixture(styles) {
  createRoot(document.querySelector('#root')).render(
    React.createElement(
      'main',
      { id: 'page', className: styles.page },
      React.createElement(
        'section',
        { id: 'parent', className: styles.parent },
        React.createElement(
          'div',
          {
            id: 'subject',
            className: styles.card,
            'data-testid': 'build-tool-card',
          },
          'Build-tool source-map proof',
        ),
      ),
    ),
  );
}
