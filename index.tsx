import React from 'react';
import { hydrateRoot } from 'react-dom/client'; // Alterado para hydrateRoot
import { RouterProvider } from 'react-router';    // Alterado de react-router-dom
import { AuthProvider } from './contexts/AuthContext';
import './global.css';
import { router } from './router'; // Importa o router configurado

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Usa hydrateRoot com RouterProvider
hydrateRoot(
  rootElement,
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>
);
