import { type FormEvent, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { resendVerificationCodeRequest, verifyEmailCodeRequest } from "../../auth/auth.api";

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const initialEmail = useMemo(() => searchParams.get("email")?.trim() ?? "", [searchParams]);
  const initialDevCode = useMemo(() => searchParams.get("devCode")?.trim() ?? null, [searchParams]);
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(initialDevCode);

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      await verifyEmailCodeRequest({ email, code });
      setSuccessMessage("Email verified. You can login now.");
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Unable to verify code");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResend() {
    setError(null);
    setSuccessMessage(null);
    setDevCode(null);
    setIsResending(true);

    try {
      const response = await resendVerificationCodeRequest({ email });
      setSuccessMessage("Verification code was sent.");
      if (response.devVerificationCode) {
        setDevCode(response.devVerificationCode);
      }
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : "Unable to resend verification code");
    } finally {
      setIsResending(false);
    }
  }

  return (
    <section className="animate-fade-in mx-auto max-w-md rounded-3xl border border-white/70 bg-white/85 p-6 shadow-float backdrop-blur-sm sm:p-7">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Email verification</p>
        <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">Verify your email</h2>
        <p className="mt-1 text-sm text-slate-600">Enter the 6-digit code sent to your email address.</p>
      </div>

      <form className="space-y-4" onSubmit={handleVerify}>
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
          <span className="mb-1 block font-medium text-slate-700">Code</span>
          <input
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none ring-brand-200 transition focus:ring"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            minLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            required
          />
        </label>

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {successMessage ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {successMessage}
          </div>
        ) : null}

        {devCode ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Dev verification code: <span className="font-semibold">{devCode}</span>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-brand-700 hover:shadow-card disabled:opacity-60"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Verifying..." : "Verify code"}
          </button>
          <button
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:shadow-card disabled:opacity-60"
            type="button"
            onClick={handleResend}
            disabled={isResending}
          >
            {isResending ? "Resending..." : "Resend code"}
          </button>
        </div>
      </form>

      <p className="mt-4 text-sm text-slate-600">
        Back to{" "}
        <Link className="font-semibold text-brand-700 transition hover:text-brand-800" to="/login">
          Sign in
        </Link>
      </p>
    </section>
  );
}
