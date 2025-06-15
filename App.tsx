import React, { useEffect, useState } from 'react'; // Adicionado useEffect e useState
import { Navigate, Outlet } from "react-router"; 
import { useAuth } from './contexts/AuthContext';
import { LoadingSpinner } from './components/ui/LoadingSpinner'; 

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const authContextValue = useAuth();
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);
  
  if (authContextValue === undefined) {
    console.error('CRITICAL ERROR in ProtectedRoute: useAuth() returned undefined.');
    // Mesmo em erro crítico, respeitar a lógica de hasMounted para evitar hydration mismatch
    if (!hasMounted) return null;
    return (
      <div className="flex flex-col justify-center items-center h-screen bg-neutral-900 text-neutral-100">
        <LoadingSpinner size="lg" />
        <p className="mt-4 text-lg text-red-400">Erro Crítico: Contexto de Autenticação indisponível.</p>
      </div>
    );
  }

  const { isAuthenticated, isLoading } = authContextValue;

  if (!hasMounted) {
    return null; // Evita renderizar o spinner na primeira passada síncrona do cliente
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-screen bg-neutral-900">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }
  return <>{children}</>;
};

export const SuperAdminProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const authContextValue = useAuth();
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (authContextValue === undefined) {
     console.error('CRITICAL ERROR in SuperAdminProtectedRoute: useAuth() returned undefined.');
     if (!hasMounted) return null;
    return (
      <div className="flex flex-col justify-center items-center h-screen bg-neutral-900 text-neutral-100">
        <LoadingSpinner size="lg" />
        <p className="mt-4 text-lg text-red-400">Erro Crítico: Contexto de Autenticação (Super Admin) indisponível.</p>
      </div>
    );
  }
  const { isAuthenticated, isSuperAdmin, isLoading } = authContextValue;

  if (!hasMounted) {
    return null; // Evita renderizar o spinner na primeira passada síncrona do cliente
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-screen bg-neutral-900">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated || !isSuperAdmin) {
    return <Navigate to={isAuthenticated ? "/dashboard" : "/auth"} replace />;
  }
  return <>{children}</>;
};

// A função App principal não é mais necessária aqui para definir rotas,
// pois createBrowserRouter e RouterProvider cuidam disso.
// Se App fosse um layout raiz, seria usado no router.tsx, como <RootLayout />.
// Por enquanto, este arquivo apenas exporta os componentes de rota protegida.
// Para evitar um "default export" não utilizado, pode-se remover a função App ou comentá-la.

// function App() {
//   // Esta função não é mais o ponto central de roteamento.
//   // O roteamento é definido em router.tsx e gerenciado por RouterProvider em index.tsx
//   return <Outlet />; // Se App fosse um layout raiz no router.tsx
// }
// export default App; // Removido ou comentado