import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/auth.context";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AppLayout } from "./layout/AppLayout";
import { HomePage } from "./pages/HomePage";
import { OrderDetailsPage } from "./pages/OrderDetailsPage";
import { OrdersPage } from "./pages/OrdersPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ProductsPage } from "./pages/ProductsPage";
import { LoginPage } from "./pages/auth/LoginPage";
import { RegisterPage } from "./pages/auth/RegisterPage";
import { VerifyEmailPage } from "./pages/auth/VerifyEmailPage";
import { isUnifiedAuthEnabled } from "./auth/unified-auth";

export function App() {
  const { isAuthenticated } = useAuth();
  const unifiedAuthEnabled = isUnifiedAuthEnabled();

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
          path="/products"
          element={
            <ProtectedRoute>
              <ProductsPage />
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
          path="/orders/:id"
          element={
            <ProtectedRoute>
              <OrderDetailsPage />
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
        <Route
          path="/register"
          element={
            unifiedAuthEnabled ? (
              <Navigate to="/signup" replace />
            ) : isAuthenticated ? (
              <Navigate to="/" replace />
            ) : (
              <RegisterPage />
            )
          }
        />
        <Route
          path="/signup"
          element={
            unifiedAuthEnabled ? (
              isAuthenticated ? (
                <Navigate to="/" replace />
              ) : (
                <RegisterPage />
              )
            ) : (
              <Navigate to="/register" replace />
            )
          }
        />
        <Route
          path="/verify-email"
          element={
            unifiedAuthEnabled ? (
              isAuthenticated ? (
                <Navigate to="/" replace />
              ) : (
                <VerifyEmailPage />
              )
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to={isAuthenticated ? "/" : "/login"} replace />} />
      </Routes>
    </AppLayout>
  );
}
