import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/auth.context";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AppLayout } from "./layout/AppLayout";
import { HomePage } from "./pages/HomePage";
import { DeliveriesPage } from "./pages/DeliveriesPage";
import { ProfilePage } from "./pages/ProfilePage";
import { LoginPage } from "./pages/auth/LoginPage";

export function App() {
  const { isAuthenticated } = useAuth();

  return (
    <AppLayout>
      <Routes>
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <HomePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/deliveries"
          element={
            <ProtectedRoute>
              <DeliveriesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />
        <Route path="/orders" element={<Navigate to="/deliveries" replace />} />
        <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="*" element={<Navigate to={isAuthenticated ? "/" : "/login"} replace />} />
      </Routes>
    </AppLayout>
  );
}
