import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signupRequest } from "../../auth/auth.api";
import { useAuth } from "../../auth/auth.context";
import { isUnifiedAuthEnabled } from "../../auth/unified-auth";

export function RegisterPage() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const unifiedAuthEnabled = isUnifiedAuthEnabled();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (unifiedAuthEnabled) {
        const response = await signupRequest({ email, password, name });
        const verifyParams = new URLSearchParams({ email });
        if (response.devVerificationCode) {
          verifyParams.set("devCode", response.devVerificationCode);
        }
        navigate(`/verify-email?${verifyParams.toString()}`, { replace: true });
      } else {
        await register({ email, password, name });
        navigate("/", { replace: true });
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to sign up");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="animate-fade-in mx-auto max-w-md rounded-3xl border border-white/70 bg-white/85 p-6 shadow-float backdrop-blur-sm sm:p-7">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Create account</p>
        <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">Join FOODO</h2>
        <p className="mt-1 text-sm text-slate-600">
          {unifiedAuthEnabled
            ? "Sign up as customer. We will ask for email verification."
            : "Sign up as customer. You will be logged in immediately."}
        </p>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Name</span>
          <input
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none ring-brand-200 transition focus:ring"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={2}
          />
        </label>

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
          {isSubmitting ? "Creating account..." : "Sign up"}
        </button>
      </form>

      <p className="mt-4 text-sm text-slate-600">
        Already registered?{" "}
        <Link className="font-semibold text-brand-700 transition hover:text-brand-800" to="/login">
          Sign in
        </Link>
      </p>
    </section>
  );
}
