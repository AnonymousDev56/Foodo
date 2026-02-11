import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/auth.context";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AppLayout } from "./layout/AppLayout";
import { CouriersPage } from "./pages/CouriersPage";
import { HomePage } from "./pages/HomePage";
import { OrdersPage } from "./pages/OrdersPage";
import { ProfilePage } from "./pages/ProfilePage";
import { WarehousePage } from "./pages/WarehousePage";
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
          path="/orders"
          element={
            <ProtectedRoute>
              <OrdersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/warehouse"
          element={
            <ProtectedRoute>
              <WarehousePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/couriers"
          element={
            <ProtectedRoute>
              <CouriersPage />
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
        <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="*" element={<Navigate to={isAuthenticated ? "/" : "/login"} replace />} />
      </Routes>
    </AppLayout>
  );
}
