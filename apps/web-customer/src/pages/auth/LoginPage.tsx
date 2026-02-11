import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AuthApiError, loginUnifiedRequest } from "../../auth/auth.api";
import { useAuth } from "../../auth/auth.context";
import { isUnifiedAuthEnabled, resolveLoginRedirect, storeAccessTokenByRole } from "../../auth/unified-auth";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const unifiedAuthEnabled = isUnifiedAuthEnabled();
  const [email, setEmail] = useState("customer@foodo.local");
  const [password, setPassword] = useState("customer123");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo =
    typeof location.state === "object" && location.state && "from" in location.state
      ? (location.state.from as { pathname?: string })?.pathname ?? "/"
      : "/";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (unifiedAuthEnabled) {
        const response = await loginUnifiedRequest({ email, password });
        storeAccessTokenByRole(response.user.role, response.accessToken);
        const destination = resolveLoginRedirect(response.user.role);

        if (destination === "/") {
          navigate(redirectTo, { replace: true });
        } else {
          window.location.assign(destination);
        }
      } else {
        await login({ email, password });
        navigate(redirectTo, { replace: true });
      }
    } catch (submitError) {
      if (unifiedAuthEnabled && submitError instanceof AuthApiError && submitError.code === "EMAIL_NOT_VERIFIED") {
        navigate(`/verify-email?email=${encodeURIComponent(email)}`, { replace: true });
        return;
      }

      setError(submitError instanceof Error ? submitError.message : "Unable to login");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="animate-fade-in mx-auto max-w-md rounded-3xl border border-white/70 bg-white/85 p-6 shadow-float backdrop-blur-sm sm:p-7">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Customer Access</p>
        <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">Sign in</h2>
        <p className="mt-1 text-sm text-slate-600">Use your FOODO account to continue.</p>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Email</span>
          <input
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none ring-brand-200 transition focus:ring"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Password</span>
          <input
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none ring-brand-200 transition focus:ring"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={6}
          />
        </label>

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <button
          className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-brand-700 hover:shadow-card disabled:opacity-60"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <p className="mt-4 text-sm text-slate-600">
        No account?{" "}
        <Link
          className="font-semibold text-brand-700 transition hover:text-brand-800"
          to={unifiedAuthEnabled ? "/signup" : "/register"}
        >
          Create one
        </Link>
      </p>
    </section>
  );
}
